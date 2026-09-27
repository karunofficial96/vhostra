import {
    app,
    BrowserWindow,
    dialog,
    ipcMain,
    Menu,
    nativeImage,
    protocol,
    shell,
    Tray,
    type MenuItemConstructorOptions,
} from "electron";
import { existsSync, readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { VhostraStore } from "./store.js";
import { DockerRuntimeController, type RuntimeState } from "./runtime.js";
import { HostsFileManager } from "./hosts.js";
import { listPersistentLogs, readLogTail } from "./logs.js";
import { createShutdownManager } from "./shutdown.js";
import { configureStartup } from "./startup.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let store: VhostraStore;
let services: DockerRuntimeController;
let hosts: HostsFileManager;
let primaryWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const applicationIcon =
    process.platform === "darwin"
        ? path.join(__dirname, "../build/icon.icns")
        : process.platform === "win32"
          ? path.join(__dirname, "../build/icon.ico")
          : path.join(__dirname, "../build/icons/512x512.png");
const preloadPath = path.join(__dirname, "preload.cjs");
// Tray artwork is separate from the dock icon so its glyph has transparent
// native-menu padding instead of a baked rectangular app-icon background.
const trayIcon = app.isPackaged
    ? path.join(process.resourcesPath, "trayIcon.png")
    : path.join(__dirname, "../build/trayIcon.png");

function createRuntimeController() {
    services?.dispose();
    services = new DockerRuntimeController(
        store.layout,
        () => store.getState(),
        (message) => store.updateLocalhostWelcome(message),
    );
    hosts = new HostsFileManager(path.join(store.layout.root, "temporary"));
    services.subscribe(() => {
        primaryWindow?.webContents.send(
            "vhostra:runtime-status",
            services.current(),
        );
        updateTrayMenu();
    });
}

// A protected hosts-file write is intentionally non-transactional with site
// creation: declining elevation must not erase a valid local site definition.
// The renderer receives an actionable mapping result and can offer Repair.
async function safelyEnsureHosts(hostnames: string[]) {
    try {
        return await hosts.ensureLocalhostMappings(hostnames);
    } catch (error) {
        return {
            installed: [],
            alreadyMapped: [],
            conflicts: [],
            message: `The virtual host was saved, but its local hosts mapping still requires attention. ${error instanceof Error ? error.message : "Administrator permission was cancelled or unavailable."}`,
        };
    }
}

async function setOptionalService(id: "redis" | "memcached", enabled: boolean) {
    const state = await store.getState();
    await store.saveSettings({
        ...state.settings,
        optionalServices: { ...state.settings.optionalServices, [id]: enabled },
    });
    try {
        await services.applyConfiguration();
        await services.refresh();
    } catch (error) {
        await store.saveSettings(state.settings);
        throw error;
    }
}

const createWindow = () => {
    if (primaryWindow && !primaryWindow.isDestroyed()) {
        primaryWindow.focus();
        return primaryWindow;
    }
    if (!existsSync(preloadPath))
        console.error(
            `[Vhostra] Preload script is missing: ${preloadPath}. Run the Electron build before starting the app.`,
        );
    const window = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 860,
        minHeight: 620,
        title: "Vhostra",
        icon: applicationIcon,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            backgroundThrottling: true,
            preload: preloadPath,
        },
    });
    primaryWindow = window;
    window.on("closed", () => {
        primaryWindow = null;
    });
    window.on("close", (event) => {
        if (isQuitting) return;
        event.preventDefault();
        void store
            .getState()
            .then((state) =>
                requestShutdown(state.settings.startup.closeBehavior),
            )
            .catch(reportShutdownFailure);
    });
    window.webContents.on("preload-error", (_event, failedPath, error) =>
        console.error(
            `[Vhostra] Failed to load preload script at ${failedPath}:`,
            error,
        ),
    );
    window.webContents.on(
        "console-message",
        (_event, _level, message, line, sourceId) => {
            if (message.includes("[Vhostra preload]"))
                console.error(
                    `[Vhostra] Preload diagnostic (${sourceId}:${line}): ${message}`,
                );
        },
    );
    window.webContents.setWindowOpenHandler(({ url }) => {
        try {
            VhostraStore.validateUrl(url);
            void shell.openExternal(url);
        } catch {
            /* deny untrusted/non-web URLs */
        }
        return { action: "deny" };
    });
    const devServer = process.env.VITE_DEV_SERVER_URL;
    const renderer =
        app.isPackaged || !devServer
            ? pathToFileURL(
                  path.join(__dirname, "../dist/index.html"),
              ).toString()
            : devServer;
    window.loadURL(renderer);
    return window;
};

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (!app.isReady()) return;
        void openApplicationWindow();
    });
}

app.whenReady().then(() => {
    store = new VhostraStore(
        app.getPath("userData"),
        path.join(__dirname, "../dist-welcome"),
    );
    createRuntimeController();
    registerIpc();
    registerScreenshotProtocol();
    createTray();
    createWindow();
    void services.refresh();
    void store
        .getState()
        .then((state) => {
            if (state.settings.startup.startServicesOnLaunch)
                return services
                    .start()
                    .catch((error) =>
                        dialog.showErrorBox(
                            "Vhostra startup failed",
                            error instanceof Error ? error.message : String(error),
                        ),
                    );
        })
        .catch((error) =>
            dialog.showErrorBox(
                "Vhostra startup preferences could not be read",
                error instanceof Error ? error.message : String(error),
            ),
        );
    app.on("activate", () => {
        void openApplicationWindow();
    });
});
app.on("before-quit", () => {
    isQuitting = true;
    services?.dispose();
});

function registerIpc() {
    ipcMain.handle("vhostra:get-state", () => store.getState());
    ipcMain.handle("vhostra:save-settings", async (_event, settings) => {
        const previous = (await store.getState()).settings;
        const result = await store.saveSettings(settings);
        const loginChanged =
            result.startup.launchAtLogin !== previous.startup.launchAtLogin;
        const runtimeChanged =
            JSON.stringify({ ...result, startup: undefined }) !==
            JSON.stringify({ ...previous, startup: undefined });
        try {
            if (loginChanged)
                await configureLaunchAtLogin(result.startup.launchAtLogin);
            if (runtimeChanged) await services.applyConfiguration();
            return result;
        } catch (error) {
            await store.saveSettings(previous);
            if (loginChanged)
                await configureLaunchAtLogin(
                    previous.startup.launchAtLogin,
                ).catch(reportServiceFailure);
            throw error;
        }
    });
    ipcMain.handle("vhostra:add-site", async (_event, input) => {
        const result = await store.addSite(input);
        const mapping = await safelyEnsureHosts([
            new URL(input.url).hostname,
            ...(input.aliases ?? []),
        ]);
        await services.applyConfiguration();
        return { state: result, mapping };
    });
    ipcMain.handle("vhostra:update-site", async (_event, input) => {
        const before = await store.getState();
        const previous = before.sites.find((site) => site.id === input.id);
        const previousHost = before.virtualHosts.find(
            (host) => host.id === previous?.vhostId,
        );
        const result = await store.updateSite(input);
        const savedHost = result.virtualHosts.find(
            (host) => host.id === previous?.vhostId,
        );
        const names = savedHost
            ? [savedHost.hostname, ...savedHost.aliases]
            : [new URL(input.url).hostname];
        if (previousHost) {
            const retainedNames = new Set(
                result.virtualHosts
                    .flatMap((host) => [host.hostname, ...host.aliases])
                    .map((name) => name.toLowerCase()),
            );
            const removed = [
                previousHost.hostname,
                ...previousHost.aliases,
            ].filter((name) => !retainedNames.has(name.toLowerCase()));
            if (removed.length)
                await hosts
                    .removeVhostraMappings(removed)
                    .catch((error) =>
                        reportServiceFailure(
                            new Error(
                                `The site was saved, but old owned mappings still require cleanup. Use Repair all mappings. ${error instanceof Error ? error.message : String(error)}`,
                            ),
                        ),
                    );
        }
        const mapping = await safelyEnsureHosts(names);
        await services.applyConfiguration();
        return { state: result, mapping };
    });
    ipcMain.handle("vhostra:remove-site", async (_event, id: string) => {
        const before = await store.getState();
        const site = before.sites.find((item) => item.id === id);
        const host = before.virtualHosts.find(
            (item) => item.id === site?.vhostId,
        );
        const result = await store.removeSite(id);
        let mappingNotice = "";
        if (host) {
            const retained = new Set(
                result.virtualHosts
                    .flatMap((item) => [item.hostname, ...item.aliases])
                    .map((name) => name.toLowerCase()),
            );
            try {
                await hosts.removeVhostraMappings(
                    [host.hostname, ...host.aliases].filter(
                        (name) => !retained.has(name.toLowerCase()),
                    ),
                );
            } catch (error) {
                mappingNotice = `The definition was removed; owned mappings still need cleanup. Use Repair all mappings in Virtual Hosts. ${error instanceof Error ? error.message : String(error)}`;
            }
        }
        try {
            await services.applyConfiguration();
        } catch (error) {
            mappingNotice += ` The definition was removed; runtime configuration needs retry. ${error instanceof Error ? error.message : String(error)}`;
        }
        return { ...result, mappingNotice };
    });
    ipcMain.handle("vhostra:sync-all-hosts", async () => {
        const state = await store.getState();
        return hosts.reconcileMappings(
            state.virtualHosts
                .filter((host) => !host.builtIn)
                .flatMap((host) => [host.hostname, ...host.aliases]),
        );
    });
    ipcMain.handle("vhostra:sync-hosts", async (_event, id: string) => {
        const state = await store.getState();
        const host = state.virtualHosts.find((item) => item.id === id);
        if (!host) throw new Error("Virtual-host definition not found.");
        return hosts.ensureLocalhostMappings([host.hostname, ...host.aliases]);
    });
    ipcMain.handle("vhostra:hosts-status", async (_event, id: string) => {
        const state = await store.getState();
        const host = state.virtualHosts.find((item) => item.id === id);
        if (!host) throw new Error("Virtual-host definition not found.");
        return hosts.mappingStatus([host.hostname, ...host.aliases]);
    });
    ipcMain.handle("vhostra:get-app-info", () => ({
        name: "Vhostra",
        version: app.getVersion(),
    }));
    ipcMain.handle("vhostra:check-for-updates", () => checkForUpdates());
    ipcMain.handle(
        "vhostra:set-vhost-rewrite",
        async (_event, id: string, enabled: boolean) => {
            const result = await store.setVirtualHostRewrite(id, enabled);
            await services.setOpenLiteSpeedRewrite(enabled);
            return result;
        },
    );
    ipcMain.handle("vhostra:choose-document-root", async (event) => {
        const result = await dialog.showOpenDialog(
            BrowserWindow.fromWebContents(event.sender)!,
            { properties: ["openDirectory", "createDirectory"] },
        );
        return result.canceled ? null : (result.filePaths[0] ?? null);
    });
    ipcMain.handle("vhostra:choose-configuration-location", async (event) => {
        const result = await dialog.showOpenDialog(
            BrowserWindow.fromWebContents(event.sender)!,
            {
                title: "Choose Vhostra configuration destination",
                properties: ["openDirectory", "createDirectory"],
            },
        );
        return result.canceled ? null : (result.filePaths[0] ?? null);
    });
    ipcMain.handle(
        "vhostra:migrate-configuration-location",
        async (_event, directory: string) => {
            if (typeof directory !== "string" || !path.isAbsolute(directory))
                throw new Error(
                    "Choose an absolute local configuration destination.",
                );
            // Coordinate Vhostra's own writer before copying. This stops only the
            // Vhostra-labeled runtime; host project files and unrelated Docker resources remain untouched.
            const wasRunning = services.current().state === "running";
            if (wasRunning) await services.stop();
            try {
                const result = await store.migrateConfiguration(
                    directory,
                    async () => {
                        createRuntimeController();
                        await services.refresh();
                        if (wasRunning) await services.start();
                    },
                );
                return {
                    ...result,
                    message: wasRunning
                        ? `${result.message} The Vhostra runtime was restored from the verified new location.`
                        : result.message,
                };
            } catch (error) {
                // A failed copy never changes the pointer. Restore the already-existing
                // Vhostra runtime if this operation had stopped it before the attempt.
                // The failed destination can still own the host ports. Stop that scoped
                // container before rebuilding the controller for the restored source.
                if (wasRunning) await services.stop();
                createRuntimeController();
                if (wasRunning)
                    await services
                        .start()
                        .catch((restartError) =>
                            console.error(
                                "[Vhostra] Could not restore runtime after configuration migration failure:",
                                restartError,
                            ),
                        );
                throw error;
            }
        },
    );
    ipcMain.handle("vhostra:open-site", async (_event, value: string) => {
        await openExternal(value);
    });
    ipcMain.handle("vhostra:get-storage-layout", () => {
        const layout = store.layout;
        return {
            root: layout.root,
            settings: layout.settings,
            sites: layout.sites,
            virtualHosts: layout.virtualHosts,
            sourceConfiguration: layout.configuration.source,
            customConfiguration: layout.configuration.custom,
            importedConfiguration: layout.configuration.imported,
            generatedConfiguration: layout.configuration.generated,
            runtime: layout.runtime,
            certificates: layout.certificates,
            persistentData: layout.persistentData,
            logs: layout.logs,
            backups: layout.backups,
            exports: layout.exports,
        };
    });
    ipcMain.handle("vhostra:list-persistent-logs", () =>
        listPersistentLogs(store.layout.logs),
    );
    ipcMain.handle("vhostra:read-log-tail", (_event, relative: string) =>
        readLogTail(store.layout.logs, relative),
    );
    ipcMain.handle("vhostra:export-configuration", async () => {
        const result = await dialog.showSaveDialog({
            title: "Export Vhostra configuration",
            defaultPath: path.join(
                store.layout.exports,
                "vhostra-configuration.json",
            ),
            filters: [{ name: "Vhostra configuration", extensions: ["json"] }],
        });
        return result.canceled || !result.filePath
            ? null
            : { path: await store.exportBundle(result.filePath) };
    });
    ipcMain.handle("vhostra:preview-configuration-import", async () => {
        const result = await dialog.showOpenDialog({
            title: "Preview Vhostra configuration import",
            properties: ["openFile"],
            filters: [{ name: "Vhostra configuration", extensions: ["json"] }],
        });
        return result.canceled || !result.filePaths[0]
            ? null
            : store.previewBundle(result.filePaths[0]);
    });
    ipcMain.handle("vhostra:import-configuration", async () => {
        const result = await dialog.showOpenDialog({
            title: "Import Vhostra configuration",
            properties: ["openFile"],
            filters: [{ name: "Vhostra configuration", extensions: ["json"] }],
        });
        if (result.canceled || !result.filePaths[0]) return null;
        const imported = await store.importBundle(result.filePaths[0]);
        const mapping = await safelyEnsureHosts(
            imported.imported.flatMap((site) => [
                site.hostname,
                ...site.aliases,
            ]),
        );
        await services.applyConfiguration();
        return { ...imported, mapping };
    });
    ipcMain.handle("vhostra:get-runtime-status", () => services.current());
    ipcMain.handle("vhostra:start-services", () => services.start());
    ipcMain.handle("vhostra:stop-services", () => services.stop());
    ipcMain.handle("vhostra:restart-services", () => services.restart());
    ipcMain.handle(
        "vhostra:quit-application",
        (
            _event,
            mode: "keep-services" | "stop-services" | "minimize-to-tray",
        ) => requestShutdown(mode),
    );
    ipcMain.handle("vhostra:check-port", (_event, port: number) =>
        services.checkPort(port),
    );
    ipcMain.handle("vhostra:find-available-port", (_event, port: number) =>
        services.findAvailablePort(port),
    );
    ipcMain.handle("vhostra:reload-web-server", () =>
        services.reloadWebServer(),
    );
    ipcMain.handle(
        "vhostra:set-optional-service",
        async (_event, id: "redis" | "memcached", enabled: boolean) => {
            if (id !== "redis" && id !== "memcached")
                throw new Error(
                    "Only optional Vhostra services can be enabled or disabled.",
                );
            await setOptionalService(id, Boolean(enabled));
            return services.listManagedServices();
        },
    );
    ipcMain.handle("vhostra:list-managed-services", () =>
        services.listManagedServices(),
    );
    ipcMain.handle(
        "vhostra:control-managed-service",
        (
            _event,
            id: "web" | "mariadb" | "redis" | "memcached",
            action: "start" | "stop" | "restart",
        ) => services.controlManagedService(id, action),
    );
    ipcMain.handle("vhostra:list-databases", () => services.listDatabases());
    ipcMain.handle("vhostra:list-php-extensions", () =>
        services.listPhpExtensions(),
    );
    ipcMain.handle(
        "vhostra:manage-php-extension",
        async (
            _event,
            id: string,
            action: "install" | "enable" | "disable" | "remove",
        ) => {
            const catalog = await services.managePhpExtension(id, action);
            const state = await store.getState();
            // Persist only optional user-directed selections. Runtime-managed add-on
            // dependencies and protected modules never become ordinary preferences.
            const extensions =
                action === "install" || action === "enable"
                    ? [...new Set([...state.settings.php.extensions, id])]
                    : state.settings.php.extensions.filter(
                          (value) => value !== id,
                      );
            const disabledExtensions =
                action === "disable"
                    ? [
                          ...new Set([
                              ...state.settings.php.disabledExtensions,
                              id,
                          ]),
                      ]
                    : state.settings.php.disabledExtensions.filter(
                          (value) => value !== id,
                      );
            await store.saveSettings({
                ...state.settings,
                php: { ...state.settings.php, extensions, disabledExtensions },
            });
            return catalog;
        },
    );
    ipcMain.handle("vhostra:get-cwebp-status", () => services.getCwebpStatus());
    ipcMain.handle(
        "vhostra:configure-cwebp",
        async (_event, enabled: boolean) => {
            const result = await services.configureCwebp(Boolean(enabled));
            const state = await store.getState();
            await store.saveSettings({
                ...state.settings,
                php: { ...state.settings.php, cwebpEnabled: Boolean(enabled) },
            });
            return result;
        },
    );
    ipcMain.handle("vhostra:create-database", (_event, input) =>
        services.createDatabase(input),
    );
    ipcMain.handle(
        "vhostra:open-phpmyadmin",
        async (_event, database?: string) => {
            await openExternal(await services.phpMyAdminUrl(database));
        },
    );
    ipcMain.handle(
        "vhostra:import-database",
        async (_event, database: string) => {
            const result = await dialog.showOpenDialog({
                title: `Import into ${database}`,
                properties: ["openFile"],
                filters: [{ name: "SQL database dump", extensions: ["sql"] }],
            });
            return result.canceled || !result.filePaths[0]
                ? null
                : services.importDatabase(database, result.filePaths[0]);
        },
    );
    ipcMain.handle(
        "vhostra:export-database",
        async (_event, database: string) => {
            const result = await dialog.showSaveDialog({
                title: `Export ${database}`,
                defaultPath: `${database}.sql`,
                filters: [{ name: "SQL database dump", extensions: ["sql"] }],
            });
            return result.canceled || !result.filePath
                ? null
                : services.exportDatabase(database, result.filePath);
        },
    );
    ipcMain.handle("vhostra:repair-database", (_event, database: string) =>
        services.repairDatabase(database),
    );
    ipcMain.handle("vhostra:delete-database", (_event, database: string) =>
        services.deleteDatabase(database),
    );
}

async function checkForUpdates() {
    const currentVersion = app.getVersion();
    const source = process.env.VHOSTRA_UPDATE_URL;
    if (!source)
        return {
            state: "unconfigured" as const,
            currentVersion,
            message:
                "No production update source is configured for this build.",
        };
    try {
        const endpoint = new URL(source);
        if (endpoint.protocol !== "https:")
            throw new Error("The configured update source must use HTTPS.");
        const response = await fetch(endpoint, {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok)
            throw new Error(`Update server returned HTTP ${response.status}.`);
        const release = (await response.json()) as {
            version?: unknown;
            notes?: unknown;
            url?: unknown;
        };
        if (typeof release.version !== "string" || !semver(release.version))
            throw new Error(
                "Update metadata does not contain a valid semantic version.",
            );
        const url =
            typeof release.url === "string" && /^https:\/\//.test(release.url)
                ? release.url
                : undefined;
        const notes =
            typeof release.notes === "string"
                ? release.notes.slice(0, 12_000)
                : undefined;
        return semverCompare(release.version, currentVersion) > 0
            ? {
                  state: "available" as const,
                  currentVersion,
                  availableVersion: release.version,
                  notes,
                  url,
                  message: `Vhostra ${release.version} is available.`,
              }
            : {
                  state: "up-to-date" as const,
                  currentVersion,
                  message: "Vhostra is up to date.",
              };
    } catch (error) {
        return {
            state: "error" as const,
            currentVersion,
            message:
                error instanceof Error
                    ? error.message
                    : "Vhostra could not check for updates.",
        };
    }
}
const semver = (value: string) =>
    /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
        value,
    );
const semverCompare = (left: string, right: string) => {
    const parse = (value: string) =>
        value.replace(/^v/, "").split(/[.+-]/).slice(0, 3).map(Number);
    const [a, b, c] = parse(left);
    const [x, y, z] = parse(right);
    return a - x || b - y || c - z;
};

async function configureLaunchAtLogin(enabled: boolean) {
    await configureStartup(enabled, {
        platform: process.platform,
        home: app.getPath("home"),
        configHome: process.env.XDG_CONFIG_HOME,
        executable: process.execPath,
        appPath: app.getAppPath(),
        packaged: app.isPackaged,
        setLoginItemSettings: (settings) => app.setLoginItemSettings(settings),
        getLoginItemSettings: (options) => app.getLoginItemSettings(options),
    });
}

async function openApplicationWindow() {
    const window = createWindow();
    window.show();
    window.focus();
}
async function openExternal(value: string) {
    VhostraStore.validateUrl(value);
    await shell.openExternal(value);
}

const requestShutdown = createShutdownManager({
    refresh: () => services.refresh(),
    stop: () => services.stop(),
    hide: () => createWindow().hide(),
    quit: () => {
        isQuitting = true;
        app.quit();
    },
});

function reportServiceFailure(error: unknown) {
    dialog.showErrorBox(
        "Vhostra service action failed",
        error instanceof Error
            ? error.message
            : "The requested service action could not be completed.",
    );
}

function reportShutdownFailure(error: unknown) {
    dialog.showErrorBox(
        "Vhostra remains open",
        error instanceof Error
            ? error.message
            : "Services could not be stopped safely.",
    );
}

function createTray() {
    // Menu bars render native image pixels directly. Keep the padded source for
    // HiDPI clarity, then use a compact logical size so Vhostra is a small mark
    // rather than a dock icon squeezed into the status area.
    const image = nativeImage.createEmpty();
    image.addRepresentation({ scaleFactor: 1, buffer: readFileSync(trayIcon) });
    image.addRepresentation({
        scaleFactor: 2,
        buffer: readFileSync(trayIcon.replace(/\.png$/, "@2x.png")),
    });
    if (image.isEmpty())
        console.error(
            `[Vhostra] Tray artwork could not be loaded: ${trayIcon}`,
        );
    // Do not mark this colour Vhostra artwork as a macOS template image. Template
    // images are monochromatically tinted by the menu bar, which would erase the
    // branded red tray mark and make it appear oversized/white.
    image.setTemplateImage(false);
    tray = new Tray(image);
    tray.setToolTip("Vhostra");
    tray.on("click", () => {
        void openApplicationWindow();
    });
    services.subscribe(updateTrayMenu);
    updateTrayMenu();
}

function updateTrayMenu() {
    if (!tray) return;
    const status = services.current();
    const state = trayState(status.state);
    const controlsAvailable = !["unavailable", "starting", "stopping"].includes(
        status.state,
    );
    const action = (operation: "start" | "stop" | "restart") => () => {
        void services[operation]()
            .catch(reportServiceFailure)
            .finally(updateTrayMenu);
        updateTrayMenu();
    };
    const managed =
        status.state === "running"
            ? ([] as Awaited<ReturnType<typeof services.listManagedServices>>)
            : [];
    void services
        .listManagedServices()
        .then((rows) => {
            managed.splice(0, managed.length, ...rows);
            if (tray) updateTrayMenuWithManaged(rows);
        })
        .catch(() => {});
    const items: MenuItemConstructorOptions[] = [
        {
            label: "Open Vhostra",
            click: () => {
                void openApplicationWindow();
            },
        },
        {
            label: "Open localhost in default browser",
            click: () => {
                void store
                    .getLocalhostUrl()
                    .then(openExternal)
                    .catch((error) =>
                        console.error(
                            "[Vhostra] Opening localhost failed:",
                            error,
                        ),
                    );
            },
        },
        { type: "separator" },
        ...(state === "unavailable"
            ? [
                  {
                      label: status.message,
                      enabled: false,
                  } satisfies MenuItemConstructorOptions,
              ]
            : []),
        {
            label: "Start Services",
            enabled:
                controlsAvailable &&
                (state === "stopped" ||
                    state === "not-created" ||
                    state === "error"),
            click: action("start"),
        },
        {
            label: "Stop Services",
            enabled: controlsAvailable && state === "running",
            click: action("stop"),
        },
        {
            label: "Restart Services",
            enabled: controlsAvailable && state === "running",
            click: action("restart"),
        },
        { type: "separator" },
        {
            label: "Quit Vhostra, Keep Services Running",
            click: () => {
                void requestShutdown("keep-services");
            },
        },
        {
            label: "Quit Vhostra and Stop Services",
            click: () => {
                void requestShutdown("stop-services").catch(
                    reportShutdownFailure,
                );
            },
        },
    ];
    tray.setContextMenu(Menu.buildFromTemplate(items));
    tray.setToolTip(
        state === "unavailable"
            ? "Vhostra — Docker unavailable"
            : `Vhostra — services ${state}`,
    );
}

function updateTrayMenuWithManaged(
    managed: Awaited<ReturnType<typeof services.listManagedServices>>,
) {
    if (!tray) return;
    const status = services.current();
    const state = trayState(status.state);
    const controlsAvailable = state === "running";
    const control =
        (
            id: "web" | "mariadb" | "redis" | "memcached",
            action: "start" | "stop" | "restart",
        ) =>
        () => {
            void services
                .controlManagedService(id, action)
                .catch(reportServiceFailure)
                .finally(updateTrayMenu);
        };
    const componentMenus: MenuItemConstructorOptions[] = managed.map(
        (service) => ({
            label: `${service.label}: ${service.state}`,
            submenu: service.enabled
                ? [
                      {
                          label: "Start",
                          enabled:
                              controlsAvailable &&
                              service.state !== "running" &&
                              service.state !== "starting",
                          click: control(service.id, "start"),
                      },
                      {
                          label: "Stop",
                          enabled:
                              controlsAvailable && service.state === "running",
                          click: control(service.id, "stop"),
                      },
                      {
                          label: "Restart",
                          enabled:
                              controlsAvailable && service.state === "running",
                          click: control(service.id, "restart"),
                      },
                      ...(service.id === "redis" || service.id === "memcached"
                          ? [
                                { type: "separator" as const },
                                {
                                    label: "Disable",
                                    enabled: !["starting", "stopping"].includes(
                                        state,
                                    ),
                                    click: () => {
                                        void setOptionalService(
                                            service.id as "redis" | "memcached",
                                            false,
                                        )
                                            .catch(reportServiceFailure)
                                            .finally(updateTrayMenu);
                                    },
                                },
                            ]
                          : []),
                  ]
                : service.id === "redis" || service.id === "memcached"
                  ? [
                        {
                            label: "Enable",
                            enabled: !["starting", "stopping"].includes(state),
                            click: () => {
                                void setOptionalService(
                                    service.id as "redis" | "memcached",
                                    true,
                                )
                                    .catch(reportServiceFailure)
                                    .finally(updateTrayMenu);
                            },
                        },
                    ]
                  : [{ label: "Not available", enabled: false }],
        }),
    );
    const action = (operation: "start" | "stop" | "restart") => () => {
        void services[operation]()
            .catch(reportServiceFailure)
            .finally(updateTrayMenu);
    };
    tray.setContextMenu(
        Menu.buildFromTemplate([
            {
                label: "Open Vhostra",
                click: () => {
                    void openApplicationWindow();
                },
            },
            {
                label: "Open localhost in default browser",
                click: () => {
                    void store
                        .getLocalhostUrl()
                        .then(openExternal)
                        .catch((error) =>
                            console.error(
                                "[Vhostra] Opening localhost failed:",
                                error,
                            ),
                        );
                },
            },
            { type: "separator" },
            ...componentMenus,
            { type: "separator" },
            {
                label: "Start Services",
                enabled:
                    !["unavailable", "starting", "stopping"].includes(state) &&
                    (state === "stopped" ||
                        state === "not-created" ||
                        state === "error"),
                click: action("start"),
            },
            {
                label: "Stop Services",
                enabled: state === "running",
                click: action("stop"),
            },
            {
                label: "Restart Services",
                enabled: state === "running",
                click: action("restart"),
            },
            { type: "separator" },
            {
                label: "Quit Vhostra, Keep Services Running",
                click: () => {
                    void requestShutdown("keep-services");
                },
            },
            {
                label: "Quit Vhostra and Stop Services",
                click: () => {
                    void requestShutdown("stop-services").catch(
                        reportShutdownFailure,
                    );
                },
            },
        ]),
    );
}

function trayState(state: RuntimeState): RuntimeState {
    return state;
}

function registerScreenshotProtocol() {
    protocol.handle("vhostra-screenshot", async (request) => {
        try {
            const url = new URL(request.url);
            if (url.hostname !== "site")
                return new Response("Not found", { status: 404 });
            const image = await store.readScreenshot(url.pathname.slice(1));
            return image
                ? new Response(image.data, {
                      headers: {
                          "content-type": image.mime,
                          "cache-control": "private, max-age=3600",
                      },
                  })
                : new Response("Not found", { status: 404 });
        } catch {
            return new Response("Not found", { status: 404 });
        }
    });
}
