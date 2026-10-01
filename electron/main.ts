import { mapDiagnosticPaths } from './errors.js';
import { exportFullBackup, previewFullBackup, restoreFullDatabase, proveDatabaseEquality, type FullBackupPlan } from './backup.js';
import type { RestoreChoices } from './reconciliation.js';
import {
    app,
    BrowserWindow,
    screen,
    dialog,
    ipcMain,
    Menu,
    nativeImage,
    protocol,
    shell,
    Tray,
    type MenuItemConstructorOptions,
} from "electron";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SiteUrlResolver, previewMatches, publicSiteUrl } from "./site-url.js";
import { SitePreviews } from "./previews.js";
import { updateManagedSite } from "./site-workflow.js";
import { VhostraStore, type AppState, type WebServer } from "./store.js";
import { DockerRuntimeController, type RuntimeState, type RuntimeSnapshot } from "./runtime.js";
import { HostsFileManager } from "./hosts.js";
import { listPersistentLogs, readLogTail, recordApplicationLog } from "./logs.js";
import { createShutdownManager } from "./shutdown.js";
import { redactProgress } from "./progress.js";
import { startResourceDiagnostics } from "./diagnostics.js";
import { readNativeConfiguration, type NativeImportPreview, type SourceServer } from "./config-import.js";
import { localStorageUsage } from "./resources.js";
import { supportedPhpVersions } from "./store.js";
import { configureStartup } from "./startup.js";
import { openFileDialog, saveFileDialog } from "./file-dialogs.js";

if (!app.isPackaged && process.env.NODE_ENV === "development" && process.env.VHOSTRA_DEV_PROFILE) {
    if (!path.isAbsolute(process.env.VHOSTRA_DEV_PROFILE)) throw new Error("VHOSTRA_DEV_PROFILE must be an absolute local test directory.");
    app.setPath("userData", process.env.VHOSTRA_DEV_PROFILE);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
let store: VhostraStore;
let cancelPreviewCapture: (() => void) | undefined;
let clearPreviewFailures: (() => void) | undefined;
let pendingBackup: { source: string; checksum: string; plans: Record<string, string>; full?: FullBackupPlan } | null = null;
let pendingNativePlans: Record<string, string> = {};
let pendingNativeImport: NativeImportPreview | null = null;
let storageCacheRoot = "";
let storageCache: Awaited<ReturnType<typeof localStorageUsage>> | null = null;
let desktopMutation = false;
let resourceRequest: Promise<unknown> | null = null;
let services: DockerRuntimeController;
let hosts: HostsFileManager;
let primaryWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let trayImage: Electron.NativeImage | null = null;
let windowVisible = false;
let windowMinimized = false;
let trayStatusKey = "";
let loggedRuntimeKey = "";
let trayRefreshPending = false;
let trayRefreshAgain = false;
let lastVisibleRefresh = 0;
let isQuitting = false;
let migrationProgress: RuntimeSnapshot["progress"];
let migrationMessage = "";
const migrationSeen = new Map<DockerRuntimeController, { id: number; total: number }>();
function desktopRuntimeSnapshot(): RuntimeSnapshot {
    const snapshot = services.current();
    return migrationProgress ? { ...snapshot, state: "starting", message: migrationMessage, progress: { ...migrationProgress, lines: [...migrationProgress.lines] } } : snapshot;
}
function publishRuntimeStatus() {
    if (!primaryWindow || primaryWindow.isDestroyed() || !primaryWindow.isVisible() || primaryWindow.isMinimized() || primaryWindow.webContents.isDestroyed()) return;
    primaryWindow.webContents.send("vhostra:runtime-status", desktopRuntimeSnapshot());
}
function recordMigrationStage(message: string) {
    if (!migrationProgress) return;
    migrationMessage = redactProgress(message).slice(0, 2000);
    migrationProgress.lines = [...migrationProgress.lines, migrationMessage].slice(-300);
    migrationProgress.total++;
    publishRuntimeStatus();
    updateTrayForTransition();
}

function updateTrayForTransition() {
    const snapshot = services.current();
    const state = trayState(snapshot.state);
    const key = JSON.stringify([state, snapshot.services, Boolean(migrationProgress || snapshot.progress),
        ["error", "unavailable"].includes(state) ? snapshot.message : ""]);
    if (key !== trayStatusKey) { trayStatusKey = key; updateTrayMenu(); }
    const logKey = JSON.stringify([snapshot.state, Boolean(snapshot.progress), snapshot.state === "error" ? snapshot.message : ""]);
    if (logKey !== loggedRuntimeKey) { loggedRuntimeKey = logKey; void recordApplicationLog(store.layout.logs, redactProgress(`${snapshot.state}: ${snapshot.message}`)); }
}

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
    trayStatusKey = "";
    const testScope = process.env.VHOSTRA_TEST_SCOPE;
    if (testScope && (app.isPackaged || !/^vhostra-[a-z0-9-]+$/.test(testScope))) throw new Error('Invalid isolated Vhostra test scope.');
    services = new DockerRuntimeController(
        store.layout,
        () => store.getState(),
        (message) => store.updateLocalhostWelcome(message),
        testScope,
    );
    hosts = new HostsFileManager(path.join(store.layout.root, "temporary"), path.join(store.layout.backups, "hosts"));
    const controller = services;
    let previewRuntimeReady = false;
    services.subscribe(() => {
        if (controller !== services && !migrationProgress) return;
        const snapshot = controller.current();
        const ready = snapshot.state === "running" && !snapshot.progress;
        if (ready && !previewRuntimeReady) clearPreviewFailures?.();
        previewRuntimeReady = ready;
        if (migrationProgress && snapshot.progress) {
            const seen = migrationSeen.get(controller);
            const count = seen?.id === snapshot.progress.id ? seen.total : 0;
            const lines = snapshot.progress.lines.slice(Math.max(0, snapshot.progress.lines.length - (snapshot.progress.total - count)));
            migrationSeen.set(controller, { id: snapshot.progress.id, total: snapshot.progress.total });
            migrationProgress.lines = [...migrationProgress.lines, ...lines].slice(-300);
            migrationProgress.total += lines.length;
            migrationMessage = snapshot.message;
        }
        publishRuntimeStatus();
        updateTrayForTransition();
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
    services.beginOptionalServiceChange(id, enabled);
    try {
        await store.saveSettings({
            ...state.settings,
            optionalServices: { ...state.settings.optionalServices, [id]: enabled },
        });
        await services.applyConfiguration();
        await services.refresh();
    } catch (error) {
        await store.saveSettings(state.settings);
        throw error;
    } finally { services.endOptionalServiceChange(id); }
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
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const width = Math.min(1280, area.width);
    const height = Math.min(820, area.height);
    const window = new BrowserWindow({
        width,
        height,
        x: area.x + Math.floor((area.width - width) / 2),
        y: area.y + Math.floor((area.height - height) / 2),
        title: "Vhostra",
        maximizable: false,
        fullscreenable: false,
        resizable: false,
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
    windowVisible = window.isVisible(); windowMinimized = window.isMinimized();
    window.setMenuBarVisibility(false);
    window.setAutoHideMenuBar(true);
    if (process.platform !== "darwin") window.removeMenu();
    window.setResizable(false);
    window.setMaximizable(false);
    window.setFullScreenable(false);
    // Some Linux window managers ignore Electron's maximize setting.
    if (process.platform === "linux") window.on("maximize", () => window.unmaximize());
    const refreshVisibleRuntime = () => {
        publishRuntimeStatus();
        if (services.current().progress || Date.now() - lastVisibleRefresh < 5000) return;
        lastVisibleRefresh = Date.now();
        void services.refresh().then(updateTrayMenu);
    };
    window.on("focus", refreshVisibleRuntime);
    window.on("show", () => { windowVisible = true; refreshVisibleRuntime(); updateTrayMenu(); });
    window.on("restore", () => { windowMinimized = false; windowVisible = true; publishRuntimeStatus(); updateTrayMenu(); });
    const retainTray = () => { if (!tray || tray.isDestroyed()) createTray(); else if (trayImage) tray.setImage(trayImage); updateTrayMenu(); };
    window.on("hide", () => { windowVisible = false; cancelPreviewCapture?.(); retainTray(); });
    window.on("minimize", () => { windowMinimized = true; cancelPreviewCapture?.(); retainTray(); });
    window.on("closed", () => {
        primaryWindow = null; windowVisible = false; windowMinimized = false;
        if (!isQuitting) updateTrayMenu();
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
        (details) => {
            const { message, lineNumber: line, sourceId } = details;
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
        void app.whenReady().then(openApplicationWindow);
    });
}

if (hasSingleInstanceLock) app.whenReady().then(() => {
    store = new VhostraStore(
        app.getPath("userData"),
        path.join(__dirname, "../dist-welcome"),
        async names => {
            const statuses = await hosts.mappingStatus(names);
            const conflicts = statuses.filter(item => item.state === "conflict");
            if (conflicts.length) throw new Error(`Hosts-file conflict: ${conflicts.map(item => `${item.hostname} maps to ${item.address}`).join(", ")}. The site was not saved.`);
        },
    );
    createRuntimeController();
    registerIpc();
    registerScreenshotProtocol();
    installApplicationMenu();
    createTray();
    createWindow();
    startResourceDiagnostics(() => services, () => Boolean(primaryWindow?.isVisible() && !primaryWindow.isMinimized()));
    void store
        .getState()
        .then(async (state) => {
            await services.refresh();
            if (store.didMigrateUnifiedSites && services.current().state !== 'unavailable') {
                try { await services.applyConfiguration(); }
                catch (error) {
                    dialog.showErrorBox('Site configuration needs attention', `Your Site definitions were preserved. Vhostra could not refresh the selected server: ${error instanceof Error ? error.message : String(error)}`);
                    return;
                }
            }
            if ((await store.getOnboarding()).completed && state.settings.startup.startServicesOnLaunch && services.current().state !== 'running')
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
app.on("window-all-closed", () => { if (!isQuitting) updateTrayMenu(); });
app.on("before-quit", (event) => {
    if (!isQuitting && services) { event.preventDefault(); void requestExplicitQuit(); return; }
    services?.dispose();
    tray?.destroy(); tray = null; trayImage = null;
});

/** Raw source stays private on disk; ordinary state IPC does not duplicate it
 * into the renderer. Review uses explicit parser findings/directives instead. */
function desktopState(state: AppState) {
    return { ...state, sites: state.sites.map(site => previewMatches(state, site) ? site : { ...site, screenshot: undefined }), virtualHosts: state.virtualHosts.map(host => host.source ? { ...host, source: { ...host.source, raw: undefined } } : host) };
}

const backupProgress = (message: string) => { if (primaryWindow?.isVisible() && !primaryWindow.isMinimized()) primaryWindow.webContents.send("vhostra:backup-progress", message.slice(0, 2000)); };
async function previewBackupFile(source: string) {
    const full = await previewFullBackup(source, services, backupProgress);
    backupProgress("Checking Site configurations…");
    const preview = await store.previewBundle(full?.configuration ?? source);
    const plans = Object.fromEntries(preview.sites.filter((site: { disposition: string }) => site.disposition === "new").map((site: { hostname: string; canonicalId: string }) => [site.hostname, /^[a-f0-9-]{36}$/i.test(site.canonicalId) ? site.canonicalId : randomUUID()]));
    pendingBackup = { source: preview.source, checksum: preview.checksum, plans, full: full ?? undefined };
    return { ...preview, warnings: full ? preview.warnings.filter(warning => !warning.startsWith("This configuration bundle")).concat("Full backup includes database data, users, roles and grants. Website files, cache contents, system accounts and private TLS keys are excluded. Keep the private sibling folder with the manifest.") : preview.warnings, source, databaseItems: full?.items ?? [], plannedLogs: Object.fromEntries(Object.entries(plans).map(([hostname, id]) => [hostname, { access: path.join(store.layout.logs, "sites", id, "access.log"), error: path.join(store.layout.logs, "sites", id, "error.log") }])) };
}
function registerIpc() {
    const assertExportDestination = async (destination: string) => {
        const parent = await fs.realpath(path.dirname(destination));
        const managed = await fs.realpath(store.layout.root);
        const exports = await fs.realpath(store.layout.exports).catch(() => path.resolve(store.layout.exports));
        const within = (child: string, root: string) => child === root || child.startsWith(root + path.sep);
        if (within(parent, managed) && !within(parent, exports)) throw new Error('Choose an export destination outside Vhostra active configuration and runtime storage.');
    };
    const migrationMutations = new Set([
        "cancel-backup-preview", "export-full-backup", "compare-backup-database", "repair-site", "finish-onboarding", "reset-app", "edit-hosts", "restore-backup", "setup-onboarding", "save-onboarding", "apply-native-import", "save-settings", "add-site", "update-site", "remove-site", "sync-all-hosts", "sync-hosts",
        "set-vhost-rewrite", "import-configuration", "start-services", "stop-services", "restart-services",
        "reload-web-server", "set-optional-service", "control-managed-service", "manage-php-extension",
        "configure-cwebp", "create-database", "update-database-access", "import-database", "export-database", "export-production-database", "export-site-configuration", "repair-database", "delete-database", "quit-application",
    ]);
    const handle = (channel: string, listener: Parameters<typeof ipcMain.handle>[1]) => ipcMain.handle(channel, async (event, ...args) => {
        const mutating = migrationMutations.has(channel.replace("vhostra:", ""));
        if (mutating && (migrationProgress || desktopMutation)) throw new Error("A Vhostra configuration/runtime operation is in progress. Wait for it to complete before changing definitions or settings.");
        if (mutating) desktopMutation = true;
        try { return await listener(event, ...args); } catch (error) {
            const state = await store.getState().catch(()=>null);
            const mappings: Array<[string,string]> = [['/etc/vhostra/nginx',store.layout.runtime.nginx],['/etc/vhostra/apache',store.layout.runtime.apache],['/etc/vhostra/php',store.layout.runtime.php],['/etc/vhostra/openlitespeed',store.layout.runtime.openLiteSpeed],['/usr/local/lsws/conf/vhostra-sites',store.layout.runtime.openLiteSpeed],['/var/log/vhostra',store.layout.logs],['/var/www/html',path.join(store.layout.sites,'localhost','public')], ...(state?.sites ?? []).filter(site=>!site.builtIn).map(site=>[`/var/www/vhostra/${site.vhostId}`,site.documentRoot] as [string,string])];
            const suppliedSecrets = args.flatMap(value => value && typeof value === 'object' ? Object.entries(value).filter(([key,item])=> /password|secret|token|credential/i.test(key) && typeof item === 'string').map(([,item])=>item as string) : []);
            throw new Error(mapDiagnosticPaths(redactProgress(await services.redactLocalLog(error instanceof Error ? error.message : String(error)),suppliedSecrets),mappings));
        } finally { if (mutating) desktopMutation = false; }
    });
    handle("vhostra:cancel-backup-preview", () => { pendingBackup = null; backupProgress(""); });
    handle("vhostra:compare-backup-database", async (_event, key: string) => {
        if (!pendingBackup?.full) throw new Error("Select a full backup first.");
        return proveDatabaseEquality(pendingBackup.full, services, key, path.join(store.layout.root, "temporary"));
    });
    handle("vhostra:export-full-backup", async () => {
        const result = await saveFileDialog({ title: "Export full Vhostra backup", defaultPath: path.join(store.layout.exports, "vhostra-backup.json"), filters: [{ name: "Vhostra backup manifest", extensions: ["json"] }] });
        return result.canceled || !result.filePath ? null : { path: await exportFullBackup(store, services, result.filePath, backupProgress) };
    });
    handle("vhostra:consume-quit-request", () => { const pending = pendingExplicitQuitRequest; pendingExplicitQuitRequest = false; return pending; });
    handle("vhostra:inspect-hosts", () => hosts.inspect());
    handle("vhostra:preview-previous-hosts", (_event, expected: string) => hosts.previewPrevious(expected));
    handle("vhostra:preview-hosts-edit", (_event, contents: string, expected: string) => hosts.previewEdit(contents, expected));
    handle("vhostra:edit-hosts", (_event, contents: string, expected: string, reviewId: string) => hosts.edit(contents, expected, reviewId));
    handle("vhostra:preview-backup", async () => {
        pendingBackup = null;
        const choice = await openFileDialog({ title: "Import existing Vhostra backup", properties: ["openFile"], filters: [{ name: "Vhostra configuration backup", extensions: ["json"] }] });
        if (choice.canceled || !choice.filePaths[0]) return null;
        return previewBackupFile(choice.filePaths[0]);
    });
    handle("vhostra:restore-backup", async (_event, roots: Record<string, string> = {}, choices: RestoreChoices = {}, server?: WebServer) => {
        if (!pendingBackup) throw new Error("Select and preview a Vhostra backup first.");
        const selected = pendingBackup;
        const original = await store.getState(); const preferences = await store.getOnboarding();
        try {
            if (selected.full) {
                for (const item of selected.full.items) if (item.disposition === 'conflict' && !choices[item.key]) throw new Error(`${item.name}: conflict review required.`);
            }
            backupProgress("Restoring canonical configuration…");
            const result = await store.restoreOnboardingBundle(selected.source, selected.checksum, roots, selected.plans, choices, backupProgress);
            if (server) {
                const current = await store.getState(); await store.saveSettings({ ...current.settings, selectedWebServer: server });
                result.preferences = await store.saveOnboarding({ ...result.preferences, server });
            }
            if (selected.full) {
                if (await services.databaseBackupStatus() === "absent") await services.controlManagedService("mariadb", "start");
                const restored = await restoreFullDatabase(selected.full, services, choices, store.layout.backups, backupProgress);
                for (const key of ["imported", "skipped", "replaced", "conflicted", "failed"] as const) result.summary[key] += restored.summary[key];
            }
            pendingBackup = null;
            const mapping = await safelyEnsureHosts(result.imported.flatMap(site => [site.hostname, ...site.aliases]));
            backupProgress(`Imported ${result.summary.imported} · Skipped ${result.summary.skipped} · Replaced ${result.summary.replaced} · Conflicts ${result.summary.conflicted} · Failed ${result.summary.failed}`);
            return { ...result, warnings: [...result.warnings, mapping.message] };
        } catch (error) {
            await store.restoreBackupConfiguration(original, preferences);
            throw error;
        }
    });
    handle("vhostra:reset-app", async (_event, keepSites: boolean, confirmation: string) => {
        if (typeof keepSites !== "boolean" || confirmation !== "Yes, Reset Vhostra") throw new Error("Final reset confirmation is required.");
        await store.assertResetSafe();
        const previous = (await store.getState()).settings;
        if (previous.startup.launchAtLogin) await configureLaunchAtLogin(false);
        try {
            await services.pauseBackgroundWork();
            // A declined Hosts prompt leaves runtime, definitions and databases unchanged.
            if (!keepSites) await hosts.removeVhostraMappings((await store.getState()).virtualHosts.filter(host => !host.builtIn).flatMap(host => [host.hostname, ...host.aliases]));
            await services.resetRuntime(keepSites); await services.pauseBackgroundWork();
            const result = await store.resetConfiguration(keepSites);
            pendingBackup = null; pendingNativeImport = null; storageCache = null;
            createRuntimeController(); await services.refresh(); return result;
        } catch (error) {
            if (previous.startup.launchAtLogin) await configureLaunchAtLogin(true).catch(reportServiceFailure);
            throw error;
        }
    });
    handle("vhostra:get-state", async () => desktopState(await store.getState()));
    handle("vhostra:get-onboarding", async () => ({ preferences: await store.getOnboarding(), phpVersions: supportedPhpVersions }));
    handle("vhostra:save-onboarding", async (_event, input) => {
        const previous = await store.getOnboarding();
        return store.saveOnboarding({ ...input, ready: previous.ready, completed: previous.completed });
    });
    handle("vhostra:finish-onboarding", async () => {
        const preferences = await store.getOnboarding();
        if (!preferences.ready) throw new Error("Complete runtime setup before entering Vhostra.");
        return store.saveOnboarding({ ...preferences, completed: true });
    });
    handle("vhostra:setup-onboarding", async () => {
        const preferences = await store.getOnboarding();
        if (preferences.completed) throw new Error("First-run setup is already complete. Use Settings to change your environment.");
        const { settings } = await store.getState();
        await store.saveSettings({ ...settings, selectedWebServer: preferences.server, selectedPhpVersion: preferences.php,
            optionalServices: preferences.restoredServices ?? { redis: preferences.cache === 'redis', memcached: preferences.cache === 'memcached' } });
        await services.refresh();
        if (services.current().state === 'running') await services.restart(); else await services.start();
        if (services.current().state !== 'running') throw new Error('Setup did not reach a verified running state. Retry after resolving the runtime error.');
        await store.saveOnboarding({ ...preferences, ready: true, completed: false });
        return desktopState(await store.getState());
    });
    handle("vhostra:preview-native-import", async (_event, hint?: SourceServer) => {
        pendingNativeImport = null;
        const result = await openFileDialog({ title: 'Import Site or server configuration (source stays unchanged)', properties: ['openFile', 'openDirectory'], filters: [{ name: 'Site and server configuration', extensions: ['json', 'conf', 'config', 'txt', 'xml'] }, { name: 'All files', extensions: ['*'] }] });
        if (result.canceled) return null;
        pendingNativeImport = await readNativeConfiguration(result.filePaths[0], hint);
        pendingNativePlans = Object.fromEntries(pendingNativeImport.hosts.map(host => [host.hostname, randomUUID()]));
        const { sourceText: _raw, ...preview } = pendingNativeImport;
        return { ...preview, plannedLogs: Object.fromEntries(Object.entries(pendingNativePlans).map(([name, id]) => [name, { access: path.join(store.layout.logs, "sites", id, "access.log"), error: path.join(store.layout.logs, "sites", id, "error.log") }])) };
    });
    handle("vhostra:apply-native-import", async (_event, roots: Record<string, string> = {}) => {
        const preview = pendingNativeImport;
        if (!preview) throw new Error('Preview a configuration before importing.');
        // Re-read the approved source; reject edits between preview and apply.
        const current = await readNativeConfiguration(preview.source, preview.server);
        if (current.sourceText !== preview.sourceText) throw new Error('Source changed after preview. Review it again.');
        for (const host of current.hosts) {
            const root = roots[host.hostname] ?? host.documentRoot;
            if (typeof root !== "string" || !path.isAbsolute(root) || !(await fs.stat(root).catch(() => null))?.isDirectory()) throw new Error(`Choose an existing host document root for ${host.hostname}.`);
            host.documentRoot = root;
        }
        const result = await store.importNative(current, pendingNativePlans); pendingNativeImport = null; pendingNativePlans = {};
        const mapping = await safelyEnsureHosts(result.imported.flatMap(site => {
            const host = current.hosts.find(host => host.hostname === new URL(site.url).hostname)!;
            return [host.hostname, ...host.aliases];
        }));
        try { await services.applyConfiguration(); }
        catch (error) { mapping.message += ` Canonical definitions saved; activation requires repair: ${error instanceof Error ? error.message : String(error)}`; }
        return { ...result, mapping };
    });
    handle("vhostra:get-resources", async (_event, refreshStorage = false) => {
        if (resourceRequest) return resourceRequest;
        if (!primaryWindow?.isVisible() || primaryWindow.isMinimized()) throw new Error('Resources sampling is suspended while Vhostra is hidden.');
        resourceRequest = (async () => {
            const metrics = app.getAppMetrics();
            if (!storageCache || storageCacheRoot !== store.layout.root || refreshStorage || Date.now() - Date.parse(storageCache.measuredAt) > 300000) {
                const base = app.isPackaged ? app.getAppPath() : path.resolve(__dirname, "..");
                storageCacheRoot = store.layout.root;
                const installed = process.platform === 'darwin' ? path.resolve(path.dirname(app.getPath('exe')), '..') : path.dirname(app.getPath('exe'));
                storageCache = await localStorageUsage(store.layout, app.isPackaged ? [installed] : ['dist', 'dist-electron', 'dist-welcome', 'build'].map(folder => path.join(base, folder)));
            }
            let runtime = null; let dockerStorage = null; let runtimeError: string | null = null;
            try { runtime = await services.resourceUsage(); dockerStorage = await services.resourceStorage(); }
            catch (error) { runtimeError = error instanceof Error ? error.message : String(error); }
            const statuses = await services.runtimeStatuses();
            return { statuses, application: { cpuPercent: metrics.reduce((sum, value) => sum + value.cpu.percentCPUUsage, 0), ramBytes: metrics.reduce((sum, value) => sum + value.memory.workingSetSize * 1024, 0), processes: metrics.length }, runtime, runtimeError, dockerStorage, storage: storageCache };
        })();
        try { return await resourceRequest; } finally { resourceRequest = null; }
    });
    handle("vhostra:save-settings", async (_event, settings) => {
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
    handle("vhostra:add-site", async (_event, input) => {
        if (!(await fs.stat(input.documentRoot)).isDirectory()) throw new Error("Choose an existing host document-root directory.");
        const result = await store.addSite(input);
        const mapping = await safelyEnsureHosts([
            new URL(input.url).hostname,
            ...(input.aliases ?? []),
        ]);
        try { await services.applyConfiguration(); }
        catch (error) { mapping.message += ` The definition was saved, but runtime configuration requires retry: ${error instanceof Error ? error.message : String(error)}`; }
        return { state: desktopState(result), mapping };
    });
    handle("vhostra:update-site", async (_event, input) => {
        const result = await updateManagedSite(store, hosts, services, input);
        return { ...result, state: desktopState(result.state) };
    });
    handle("vhostra:remove-site", async (_event, id: string) => {
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
                mappingNotice = `The definition was removed; owned mappings still need cleanup. Use Repair all mappings in Sites. ${error instanceof Error ? error.message : String(error)}`;
            }
        }
        try {
            await services.applyConfiguration();
        } catch (error) {
            mappingNotice += ` The definition was removed; runtime configuration needs retry. ${error instanceof Error ? error.message : String(error)}`;
        }
        return { ...desktopState(result), mappingNotice };
    });
    handle("vhostra:sync-all-hosts", async () => {
        const state = await store.getState();
        return hosts.reconcileMappings(
            state.virtualHosts
                .filter((host) => !host.builtIn)
                .flatMap((host) => [host.hostname, ...host.aliases]),
        );
    });
    handle("vhostra:sync-hosts", async (_event, id: string) => {
        const state = await store.getState();
        const host = state.virtualHosts.find((item) => item.id === id);
        if (!host) throw new Error("Virtual-host definition not found.");
        return hosts.ensureLocalhostMappings([host.hostname, ...host.aliases]);
    });
    handle("vhostra:all-hosts-status", async () => {
        const state = await store.getState(); return hosts.mappingStatus(state.virtualHosts.filter(host => !host.builtIn).flatMap(host => [host.hostname, ...host.aliases]));
    });
    handle("vhostra:hosts-status", async (_event, id: string) => {
        const state = await store.getState();
        const host = state.virtualHosts.find((item) => item.id === id);
        if (!host) throw new Error("Virtual-host definition not found.");
        return hosts.mappingStatus([host.hostname, ...host.aliases]);
    });
    handle("vhostra:get-app-info", () => ({
        name: "Vhostra",
        version: app.getVersion(),
    }));
    handle("vhostra:check-for-updates", () => checkForUpdates());
    handle(
        "vhostra:set-vhost-rewrite",
        async (_event, id: string, enabled: boolean) => {
            const before = await store.getState();
            const previous = before.virtualHosts.find(host => host.id === id);
            if (!previous) throw new Error("Site configuration not found.");
            const result = await store.setVirtualHostRewrite(id, enabled);
            try { await services.applyConfiguration(); return desktopState(result); }
            catch (error) {
                await store.setVirtualHostRewrite(id, previous.rewriteEnabled !== false);
                await services.applyConfiguration().catch(reportServiceFailure);
                throw error;
            }
        },
    );
    handle("vhostra:choose-document-root", async (event) => {
        const result = await openFileDialog(
            { properties: ["openDirectory", "createDirectory"] },
            BrowserWindow.fromWebContents(event.sender)!,
        );
        return result.canceled ? null : (result.filePaths[0] ?? null);
    });
    handle("vhostra:choose-configuration-location", async (event) => {
        const result = await openFileDialog(
            {
                title: "Choose Vhostra configuration destination",
                defaultPath: store.layout.root,
                properties: ["openDirectory", "createDirectory"],
            },
            BrowserWindow.fromWebContents(event.sender)!, true,
        );
        return result.canceled ? null : (result.filePaths[0] ?? null);
    });
    handle(
        "vhostra:migrate-configuration-location",
        async (_event, directory: string) => {
            if (typeof directory !== "string" || !path.isAbsolute(directory))
                throw new Error(
                    "Choose an absolute local configuration destination.",
                );
            const onboarding = await store.getOnboarding();
            const selectedRoot = onboarding.completed ? path.resolve(directory, 'Vhostra') : path.resolve(directory);
            if (selectedRoot === store.layout.root) return { root: selectedRoot, message: 'Vhostra is already using this local configuration path.' };
            if (migrationProgress || services.current().progress) throw new Error("A Vhostra operation is already in progress.");
            migrationProgress = { id: -Date.now(), lines: [], total: 0 };
            recordMigrationStage("Preparing configuration migration…");
            // Coordinate Vhostra's own writer before copying. This stops only the
            // Vhostra-labeled runtime; host project files and unrelated Docker resources remain untouched.
            await services.refresh();
            const wasRunning = services.current().state === "running";
            const databaseWasRunning = (await services.listManagedServices()).find(row => row.id === "mariadb")?.state === "running";
            try {
                await services.resetRuntime(false);
                await services.pauseBackgroundWork();
                const result = await (onboarding.completed ? store.migrateConfiguration.bind(store) : store.migrateConfigurationRoot.bind(store))(
                    directory,
                    async () => {
                        createRuntimeController();
                        await services.refresh();
                        if (wasRunning) await services.start(databaseWasRunning);
                        else if (databaseWasRunning) await services.controlManagedService("mariadb", "start");
                    },
                    recordMigrationStage,
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
                await services.resetRuntime(false);
                createRuntimeController();
                if (wasRunning)
                    await services
                        .start(databaseWasRunning)
                        .catch((restartError) =>
                            console.error(
                                "[Vhostra] Could not restore runtime after configuration migration failure:",
                                restartError,
                            ),
                        );
                if (!wasRunning && databaseWasRunning) await services.controlManagedService("mariadb", "start").catch(reportServiceFailure);
                throw error;
            } finally {
                migrationProgress = undefined;
                migrationSeen.clear();
                publishRuntimeStatus();
                updateTrayForTransition();
            }
        },
    );
    const siteUrls = new SiteUrlResolver(store, () => hosts, () => services.siteUrlAvailability(), (url, id) => services.verifyLegacyPreviewRoute(url, id));
    handle("vhostra:resolve-site-url", async (_event, id: string) => {
        const result = await siteUrls.resolve(id);
        return { available: result.available, url: result.url ? publicSiteUrl(result.url) : undefined, message: result.message, details: result.details, repair: result.repair };
    });
    handle("vhostra:open-site", async (_event, value: string) => {
        const state = await store.getState();
        const site = state.sites.find(site => site.url === value || site.screenshot?.url === value);
        if (site) {
            const result = await siteUrls.resolve(site.id);
            if (!result.available || !result.url) throw new Error(result.message + (result.details ? `\n${result.details}` : ""));
            await openExternal(result.url);
        } else await openExternal(value);
    });
    handle("vhostra:get-storage-layout", () => {
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
    handle("vhostra:new-site-plan", () => {
        const id = randomUUID(); return { id, logs: { access: path.join(store.layout.logs, "sites", id, "access.log"), error: path.join(store.layout.logs, "sites", id, "error.log") } };
    });
    handle("vhostra:repair-site", async (_event, id: string) => {
        const state = await store.getState(); const host = state.virtualHosts.find(host => host.id === id);
        if (!host || host.builtIn) throw new Error("Choose an external Site to repair.");
        const mapping = await safelyEnsureHosts([host.hostname, ...host.aliases]);
        await services.applyConfiguration(); return mapping;
    });
    handle("vhostra:site-details", async (_event, id: string, includeNative = false) => {
        const state = await store.getState(); const site = state.sites.find(site => site.id === id);
        if (!site) throw new Error("Site not found.");
        const host = state.virtualHosts.find(host => host.id === site.vhostId)!;
        const file = path.join(store.layout.sites, `${site.id}.json`);
        let native = "Open this section to generate a preview for the selected server.";
        if (includeNative) {
            if (host.builtIn) {
                const generated = path.join(store.layout.configuration.generated, `${state.settings.selectedWebServer}-vhosts.conf`);
                const size = await fs.stat(generated).catch(() => null);
                native = size && size.size <= 1024 * 1024 ? await fs.readFile(generated, 'utf8') : 'Start Services to generate and validate the localhost configuration.';
            } else if (state.settings.selectedWebServer === 'openlitespeed') {
                const fragments = services.exportOpenLiteSpeedFiles(host);
                native = `OpenLiteSpeed generated runtime for this Site\n\nListener and domain mapping\n${fragments.main}\nVirtual host\n${fragments.vhost}`;
            } else native = services.exportSiteConfiguration(host, state.settings.selectedWebServer);
        }
        return { host: { ...host, source: host.source ? { ...host.source, raw: undefined } : undefined }, native, nativePath: file, logs: { access: path.join(store.layout.logs, "sites", host.id, "access.log"), error: path.join(store.layout.logs, "sites", host.id, "error.log") } };
    });
    handle("vhostra:export-site-configuration", async (_event, id: string, server: WebServer) => {
        if (!['apache', 'nginx', 'openlitespeed'].includes(server)) throw new Error('Choose a supported export server.');
        const state = await store.getState();
        const site = state.sites.find(item => item.id === id);
        const host = state.virtualHosts.find(item => item.id === site?.vhostId);
        if (!site || !host) throw new Error('Site not found.');
        const result = await saveFileDialog({ title: `Export ${server} configuration`, defaultPath: `${host.hostname}-${server}${server === 'openlitespeed' ? '.json' : '.conf'}`, filters: [{ name: server === 'openlitespeed' ? 'Vhostra Site configuration' : 'Server configuration', extensions: [server === 'openlitespeed' ? 'json' : 'conf'] }] });
        if (result.canceled || !result.filePath) return null;
        await assertExportDestination(result.filePath);
        const content = server === 'openlitespeed'
            ? `${JSON.stringify({ format: 'vhostra/site', schemaVersion: 1, targetServer: server, site: { ...site, screenshot: undefined }, virtualHost: { ...host, source: host.source ? { ...host.source, raw: undefined } : undefined } }, null, 2)}\n`
            : services.exportSiteConfiguration(host, server);
        const temporary = `${result.filePath}.vhostra-${randomUUID()}.tmp`;
        try { await fs.writeFile(temporary, content, { mode: 0o600, flag: 'wx' }); await fs.rename(temporary, result.filePath); }
        finally { await fs.rm(temporary, { force: true }); }
        return { path: result.filePath, requiresReview: host.source?.status === 'Requires review' || Boolean(host.preservedDirectives?.length) };
    });
    handle("vhostra:list-persistent-logs", async (_event, filter = "all") => {
        if (filter === "all") return listPersistentLogs(store.layout.logs);
        if (filter === "runtime") return [...await listPersistentLogs(store.layout.logs, false), ...(await listPersistentLogs(path.join(store.layout.logs, "mariadb"))).map(file => ({ ...file, path: path.join("mariadb", file.path) }))].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)).slice(0, 100);
        if (!(await store.getState()).virtualHosts.some(host => host.id === filter)) throw new Error("Unknown Site log source.");
        const prefix = path.join("sites", filter);
        return (await listPersistentLogs(path.join(store.layout.logs, prefix))).map(file => ({ ...file, path: path.join(prefix, file.path) }));
    });
    handle("vhostra:read-log-tail", async (_event, relative: string) => {
        const tail = await readLogTail(store.layout.logs, relative);
        return { ...tail, text: await services.redactLocalLog(tail.text) };
    });
    handle("vhostra:export-configuration", async () => {
        const result = await saveFileDialog({
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
    handle("vhostra:preview-configuration-import", async () => {
        pendingBackup = null;
        const result = await openFileDialog({ title: "Preview Vhostra configuration import", properties: ["openFile"], filters: [{ name: "Vhostra configuration", extensions: ["json"] }] });
        if (result.canceled || !result.filePaths[0]) return null;
        return previewBackupFile(result.filePaths[0]);
    });
    handle("vhostra:import-configuration", async (_event, roots: Record<string, string> = {}, choices: RestoreChoices = {}) => {
        if (!pendingBackup) throw new Error("Select and preview a Vhostra backup first.");
        const preview = await store.previewBundle(pendingBackup.source);
        for (const site of preview.sites.filter((site: { disposition: string; hostname: string }) => site.disposition === 'new' || choices[site.hostname] === 'replace')) {
            const root = roots[site.hostname] ?? site.documentRoot;
            if (typeof root !== 'string' || !path.isAbsolute(root) || !(await fs.stat(root).catch(() => null))?.isDirectory()) throw new Error(`Choose an existing host document root for ${site.hostname} before importing.`);
        }
        const selected = pendingBackup;
        const original = await store.getState(); const preferences = await store.getOnboarding();
        let imported;
        try {
            imported = await store.importBundle(selected.source, roots, selected.checksum, selected.plans, choices, backupProgress);
            if (selected.full) {
                if (await services.databaseBackupStatus() === "absent") await services.controlManagedService("mariadb", "start");
                const restored = await restoreFullDatabase(selected.full, services, choices, store.layout.backups, backupProgress);
                for (const key of ["imported", "skipped", "replaced", "conflicted", "failed"] as const) imported.summary[key] += restored.summary[key];
            }
        } catch (error) { await store.restoreBackupConfiguration(original, preferences); throw error; }
        pendingBackup = null;
        const mapping = await safelyEnsureHosts(imported.imported.flatMap(site => [site.hostname, ...site.aliases]));
        try { await services.applyConfiguration(); }
        catch (error) { mapping.message += ` Imported definitions were saved, but runtime configuration requires retry: ${error instanceof Error ? error.message : String(error)}`; }
        return { ...imported, mapping };
    });
    let dashboardVisible = false;
    const previewVisible = () => dashboardVisible && Boolean(primaryWindow?.isVisible()) && !primaryWindow?.isMinimized();
    const previews = new SitePreviews(store, siteUrls, previewVisible, async site => {
        if (!site.database) return true;
        const database = (await services.listManagedServices()).find(row => row.id === 'mariadb');
        return database?.state === 'running' && (await services.listDatabases()).includes(site.database.name);
    });
    cancelPreviewCapture = () => previews.cancel();
    clearPreviewFailures = () => previews.clearFailures();
    handle("vhostra:preview-activity", (_event, visible: boolean) => { dashboardVisible = visible === true; if (!dashboardVisible) previews.cancel(); });
    handle("vhostra:capture-preview", async (_event, id: string, force = false) => {
        if (typeof id !== "string" || typeof force !== "boolean") throw new Error("Invalid preview request.");
        if (!previewVisible()) return { captured: false, message: "Open Dashboard to refresh previews." };
        return previews.capture(id, force);
    });
    handle("vhostra:get-runtime-status", desktopRuntimeSnapshot);
    handle("vhostra:runtime-statuses", () => services.runtimeStatuses());
    handle("vhostra:start-services", () => services.start());
    handle("vhostra:stop-services", () => services.stop());
    handle("vhostra:restart-services", () => services.restartAll());
    handle(
        "vhostra:quit-application",
        (
            _event,
            mode: "keep-services" | "stop-services" | "minimize-to-tray",
        ) => requestShutdown(mode),
    );
    handle("vhostra:check-port", (_event, port: number) =>
        services.checkPort(port),
    );
    handle("vhostra:find-available-port", (_event, port: number) =>
        services.findAvailablePort(port),
    );
    handle("vhostra:reload-web-server", () =>
        services.reloadWebServer(),
    );
    handle(
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
    handle("vhostra:list-managed-services", () =>
        services.listManagedServices(),
    );
    handle(
        "vhostra:control-managed-service",
        (
            _event,
            id: "web" | "mariadb" | "redis" | "memcached",
            action: "start" | "stop" | "restart",
        ) => services.controlManagedService(id, action),
    );
    handle("vhostra:list-databases", () => services.listDatabases());
    handle("vhostra:list-database-users", () => services.listDatabaseUsers());
    handle("vhostra:change-database-user-password", (_event, input) => services.changeDatabaseUserPassword(input));
    handle("vhostra:delete-database-user", (_event, input) => services.deleteDatabaseUser(input));
    handle("vhostra:check-database-access", (_event, input) => services.checkDatabaseAccess(input));
    handle("vhostra:update-database-access", (_event, input) => services.updateDatabaseAccess(input));
    handle("vhostra:list-php-extensions", () =>
        services.listPhpExtensions(),
    );
    handle(
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
    handle("vhostra:get-cwebp-status", () => services.getCwebpStatus());
    handle(
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
    handle("vhostra:create-database", async (_event, input) => {
        const created = await services.createDatabase(input);
        primaryWindow?.webContents.send('vhostra:database-ready', { database: created.name, siteIds: [] });
        return created;
    });
    handle(
        "vhostra:open-phpmyadmin",
        async (_event, database?: string) => {
            await openExternal(await services.phpMyAdminUrl(database));
        },
    );
    handle(
        "vhostra:import-database",
        async (_event, database: string) => {
            const result = await openFileDialog({
                title: `Import into ${database}`,
                properties: ["openFile"],
                filters: [{ name: "SQL database dump", extensions: ["sql"] }],
            });
            if (result.canceled || !result.filePaths[0]) return null;
            const imported = await services.importDatabase(database, result.filePaths[0]);
            const pendingSites = await store.markDatabaseImported(database);
            primaryWindow?.webContents.send('vhostra:database-imported', { database, siteIds: pendingSites });
            return imported;
        },
    );
    handle(
        "vhostra:export-database",
        async (_event, database: string) => {
            const result = await saveFileDialog({
                title: `Export ${database}`,
                defaultPath: `${database}.sql`,
                filters: [{ name: "SQL database dump", extensions: ["sql"] }],
            });
            return result.canceled || !result.filePath
                ? null
                : services.exportDatabase(database, result.filePath);
        },
    );
    handle('vhostra:export-production-database', async (_event, database: string, productionUrl: string, productionRoot: string) => {
        if (typeof productionUrl !== 'string' || productionUrl.length > 2048 || typeof productionRoot !== 'string' || productionRoot.length > 4096) throw new Error('Enter a valid production URL and root directory.');
        let url: URL;
        try { url = new URL(productionUrl); } catch { throw new Error('Enter a valid production URL.'); }
        if (url.protocol !== 'https:' && url.protocol !== 'http:' || url.username || url.password || !url.hostname || url.search || url.hash) throw new Error('Enter a production HTTP or HTTPS URL without credentials, query or fragment.');
        if (!productionRoot || !path.isAbsolute(productionRoot) || /[\r\n\0]/.test(productionRoot)) throw new Error('Enter an absolute production root directory.');
        if (!(await services.listDatabases()).includes(database)) throw new Error('Choose an existing database.');
        const result = await saveFileDialog({ title: `Export ${database} for production`, defaultPath: `${database}-production.sql`, filters: [{ name: 'SQL database dump', extensions: ['sql'] }] });
        if (result.canceled || !result.filePath) return null;
        await assertExportDestination(result.filePath);
        const exported = await services.exportDatabase(database, result.filePath);
        return { ...exported, message: 'Database exported successfully. Data was exported unchanged; update application-specific URLs and paths after deployment.' };
    });
    handle("vhostra:repair-database", (_event, database: string) =>
        services.repairDatabase(database),
    );
    handle("vhostra:delete-database", (_event, database: string) =>
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
        if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password)
            throw new Error("The configured update source must use HTTPS.");
        const response = await fetch(endpoint, {
            headers: { accept: "application/json" },
            redirect: "error",
            signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok)
            throw new Error(`Update server returned HTTP ${response.status}.`);
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Update metadata response is empty.");
        const chunks: Uint8Array[] = []; let bytes = 0;
        try { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 64 * 1024) throw new Error("Update metadata exceeds 64 KiB."); chunks.push(value); } }
        finally { await reader.cancel(); }
        const release = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
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

function hideApplicationWindow() {
    const window = createWindow();
    if (!tray || tray.isDestroyed()) createTray();
    windowVisible = false;
    window.hide();
    if (tray && trayImage) tray.setImage(trayImage);
    updateTrayMenu();
}
async function openApplicationWindow() {
    const window = createWindow();
    if (window.isMinimized()) window.restore();
    if (process.platform === "darwin") app.show();
    window.show(); windowVisible = true; windowMinimized = false; updateTrayMenu();
    app.focus({ steal: true });
    window.focus();
}
async function openExternal(value: string) {
    VhostraStore.validateUrl(value);
    await shell.openExternal(value);
}

const requestShutdown = createShutdownManager({
    refresh: async () => { const snapshot = await services.refresh(); if (["stopped", "not-created"].includes(snapshot.state) && !(await services.allServicesStopped())) return { ...snapshot, state: "running" }; return snapshot; },
    stop: () => services.stop(),
    hide: hideApplicationWindow,
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
    if (tray && !tray.isDestroyed()) return;
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
    trayImage = image;
    tray = new Tray(trayImage);
    tray.setToolTip("Vhostra");
    tray.on("right-click", () => {
        windowVisible = Boolean(primaryWindow?.isVisible()) && !(process.platform === "darwin" && app.isHidden());
        windowMinimized = Boolean(primaryWindow?.isMinimized());
        updateTrayMenuWithManaged(lastTrayServices);
        if (!services.current().progress) void services.refresh().then(updateTrayMenu); });
    tray.on("click", () => {
        void openApplicationWindow();
    });
    updateTrayMenu();
}

let lastTrayServices: Awaited<ReturnType<typeof services.listManagedServices>> = [];
function updateTrayMenu() {
    if (isQuitting) return;
    if (!tray || tray.isDestroyed()) createTray();
    if (!tray) return;
    // Visibility must not wait for Docker/service queries.
    if (trayRefreshPending) {
        updateTrayMenuWithManaged(lastTrayServices);
    }
    if (trayRefreshPending) { trayRefreshAgain = true; return; }
    const controller = services;
    const status = services.current();
    const state = trayState(status.state);
    const controlsAvailable = !["unavailable", "starting", "stopping"].includes(
        status.state,
    );
    const action = (operation: "start" | "stop" | "restart") => () => {
        void (operation === "restart" ? services.restartAll() : services[operation]())
            .catch(reportServiceFailure)
            .finally(updateTrayMenu);
        updateTrayMenu();
    };
    const managed =
        status.state === "running"
            ? ([] as Awaited<ReturnType<typeof services.listManagedServices>>)
            : [];
    trayRefreshPending = true;
    void services
        .listManagedServices()
        .then((rows) => {
            managed.splice(0, managed.length, ...rows);
            if (tray && controller === services) { lastTrayServices = rows; updateTrayMenuWithManaged(rows); }
        })
        .catch(() => {})
        .finally(() => { trayRefreshPending = false; if (trayRefreshAgain) { trayRefreshAgain = false; updateTrayMenu(); } });
    const items: MenuItemConstructorOptions[] = [
        ...openTrayItem(),
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
        { label: "Quit Vhostra…", click: () => { void requestExplicitQuit(); } },
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
                              (controlsAvailable || service.id === "mariadb") &&
                              service.state !== "running" &&
                              service.state !== "starting",
                          click: control(service.id, "start"),
                      },
                      {
                          label: "Stop",
                          enabled:
                              (controlsAvailable || service.id === "mariadb") && ["running", "unhealthy"].includes(service.state),
                          click: control(service.id, "stop"),
                      },
                      {
                          label: "Restart",
                          enabled:
                              (controlsAvailable || service.id === "mariadb") && ["running", "unhealthy"].includes(service.state),
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
        void (operation === "restart" ? services.restartAll() : services[operation]())
            .catch(reportServiceFailure)
            .finally(updateTrayMenu);
    };
    tray.setContextMenu(
        Menu.buildFromTemplate([
            ...openTrayItem(),
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
            { label: "Quit Vhostra…", click: () => { void requestExplicitQuit(); } },
        ]),
    );
}

function trayState(state: RuntimeState): RuntimeState {
    return migrationProgress ? "starting" : state;
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

/** Native acceptance access; no renderer IPC surface. */
export function applicationSession() { return { window: primaryWindow, tray, hasSingleInstanceLock, runtime: services, hosts, hide: hideApplicationWindow, open: openApplicationWindow }; }

function openTrayItem(): MenuItemConstructorOptions[] {
    return primaryWindow && !primaryWindow.isDestroyed() && windowVisible && !windowMinimized
        ? [] : [{ label: "Open Vhostra", click: () => { void openApplicationWindow(); } }];
}
let explicitQuitPending = false;
let pendingExplicitQuitRequest = false;
async function requestExplicitQuit() {
    if (explicitQuitPending || isQuitting) return;
    explicitQuitPending = true;
    try {
        await openApplicationWindow();
        pendingExplicitQuitRequest = true;
        primaryWindow?.webContents.send("vhostra:explicit-quit");
    } finally { explicitQuitPending = false; }
}
function installApplicationMenu() {
    const quit: MenuItemConstructorOptions = { label: "Quit Vhostra", accelerator: process.platform === "darwin" ? "Command+Q" : "Alt+F4", click: () => { void requestExplicitQuit(); } };
    const items: MenuItemConstructorOptions[] = process.platform === "darwin"
        ? [{ label: "Vhostra", submenu: [{ role: "about" }, { type: "separator" }, { label: "Hide Vhostra", accelerator: "Command+H", click: () => { windowVisible = false; app.hide(); updateTrayMenu(); } }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, quit,
            ...([['undo', 'Command+Z'], ['redo', 'Command+Shift+Z'], ['cut', 'Command+X'], ['copy', 'Command+C'], ['paste', 'Command+V'], ['selectAll', 'Command+A']] as const).map(([role, accelerator]) => ({ role, accelerator, visible: false, acceleratorWorksWhenHidden: true }))] }]
        : [{ label: "Vhostra", submenu: [quit] }];
    Menu.setApplicationMenu(Menu.buildFromTemplate(items));
}
