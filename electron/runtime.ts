import { generatedMarker, cleanObsoleteGenerated, cleanObsoleteRuntime, restoreGenerated } from "./generated-config.js";
import { redactProgress } from "./progress.js";
import { createHash, randomBytes } from "node:crypto";
import {
    createReadStream,
    createWriteStream,
    existsSync,
    watch,
    type FSWatcher,
} from "node:fs";
import { promises as fs } from "node:fs";
import { pipeline } from "node:stream/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import type { AppState, PhpVersion, StoreLayout, WebServer } from "./store.js";

export type RuntimeState =
    | "unavailable"
    | "not-created"
    | "stopped"
    | "starting"
    | "stopping"
    | "running"
    | "error";
export interface RuntimeSnapshot {
    state: RuntimeState;
    message: string;
    services: string[];
    updatedAt: string;
    progress?: { id: number; lines: string[]; total: number };
}
export interface ManagedServiceStatus {
    id: "web" | "mariadb" | "redis" | "memcached";
    label: string;
    enabled: boolean;
    state:
        | "running"
        | "stopped"
        | "starting"
        | "failed"
        | "disabled"
        | "unavailable";
}

let progressSequence = Date.now();
const actionLabel = (action: string) => ({ start: "Starting", stop: "Stopping", restart: "Restarting", install: "Installing", enable: "Enabling", disable: "Disabling", remove: "Removing" }[action] ?? action);
const projectName = "vhostra";
const managedLabel = "com.vhostra.managed=true";
const requiredHostPorts = (state: AppState) => [
    state.settings.ports.http,
    state.settings.ports.phpMyAdmin,
    state.settings.ports.mariadb,
];
const q = (value: string | number | boolean) => JSON.stringify(value);

/** Only ever operates the generated, labeled Vhostra Compose project. */
export class DockerRuntimeController {
    private snapshot: RuntimeSnapshot = {
        state: "not-created",
        message: "Docker runtime has not been created.",
        services: [],
        updatedAt: new Date().toISOString(),
    };
    private progress: { id: number; lines: string[]; total: number } | undefined;
    private hiddenProgressMaterial = false;
    private progressNotification: ReturnType<typeof setTimeout> | undefined;
    private secrets = new Set<string>();
    private listeners = new Set<() => void>();
    private operation: Promise<void> | null = null;
    private refreshOperation: Promise<RuntimeSnapshot> | null = null;
    private welcomeWrites: Promise<void> = Promise.resolve();
    private httpsWarning = "";
    private disposed = false;
    private counters = { dockerCalls: 0, composeCalls: 0, refreshes: 0, builds: 0, operations: 0 };
    private imageName = "";
    private htaccessWatchers = new Map<string, FSWatcher>();
    private htaccessRoots = new Map<string, string>();
    private htaccessGeneration = 0;
    private htaccessDebounce: ReturnType<typeof setTimeout> | null = null;

    constructor(
        private readonly layout: StoreLayout,
        private readonly getState: () => Promise<AppState>,
        private readonly updateWelcome?: (message: string) => Promise<void>,
        private readonly scope = projectName,
    ) {
        if (!/^[a-z0-9][a-z0-9_-]*$/.test(scope))
            throw new Error("Invalid Vhostra runtime project scope.");
    }

    subscribe(listener: () => void) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    current() {
        return this.snapshot;
    }
    diagnostics() {
        return { ...this.counters, operationActive: Boolean(this.operation), progressLines: this.progress?.lines.length ?? 0,
            htaccessWatchers: this.htaccessWatchers.size, state: this.snapshot.state };
    }
    async resourceUsage() {
        if (!existsSync(this.composeFile)) return null;
        const ids = (await this.docker(["ps", "--filter", `label=${managedLabel}`, "--filter", `label=com.docker.compose.project=${this.scope}`,
            "--filter", "label=com.docker.compose.service=runtime", "--quiet"])).trim().split(/\s+/).filter(Boolean);
        if (!ids.length) return null;
        return parseJsonLines(await this.docker(["stats", "--no-stream", "--format", "{{json .}}", ...ids]));
    }
    private resourceStorageCache: { measuredAt: number; value: { imageBytes: number; writableLayerBytes: number; note: string } } | null = null;
    async resourceStorage() {
        if (!existsSync(this.composeFile)) return null;
        if (this.resourceStorageCache && Date.now() - this.resourceStorageCache.measuredAt < 300000) return this.resourceStorageCache.value;
        const ids = (await this.docker(["ps", "--all", "--filter", `label=${managedLabel}`, "--filter", `label=com.docker.compose.project=${this.scope}`, "--filter", "label=com.docker.compose.service=runtime", "--quiet"])).trim().split(/\s+/).filter(Boolean);
        if (!ids.length) return null;
        const containers = JSON.parse(await this.docker(["inspect", "--size", ...ids]));
        const cachedIds = (await this.docker(["image", "ls", "--filter", "label=com.vhostra.managed=true", "--filter", "label=com.vhostra.purpose=runtime-image", "--quiet", "--no-trunc"])).trim().split(/\s+/).filter(Boolean);
        const imageIds = [...new Set<string>([...containers.map((item: { Image: string }) => item.Image), ...cachedIds])];
        const images = JSON.parse(await this.docker(["image", "inspect", ...imageIds]));
        const value = { imageBytes: images.filter((item: { Config?: { Labels?: Record<string, string> } }) => item.Config?.Labels?.['com.vhostra.managed'] === 'true' && item.Config.Labels['com.vhostra.purpose'] === 'runtime-image').reduce((sum: number, item: { Size: number }) => sum + item.Size, 0),
            writableLayerBytes: containers.reduce((sum: number, item: { SizeRw?: number }) => sum + (item.SizeRw ?? 0), 0), note: 'Exact current Vhostra project writable layers and positively labeled managed images/cache across Vhostra profiles, deduplicated by image ID. Image sizes include shared layers; volumes are host bind mounts counted in local storage. Docker Desktop and other projects are excluded.' };
        this.resourceStorageCache = { measuredAt: Date.now(), value }; return value;
    }
    async refresh() {
        if (this.refreshOperation) return this.refreshOperation;
        const result = this.refreshInternal();
        this.refreshOperation = result;
        try { return await result; }
        finally { if (this.refreshOperation === result) this.refreshOperation = null; }
    }
    async pauseBackgroundWork() {
        this.clearHtaccessWatchers();
        await this.refreshOperation;
        await this.operation;
        await this.welcomeWrites;
        this.clearHtaccessWatchers();
    }
    private async refreshInternal() {
        this.counters.refreshes++;
        try {
            await this.docker(["info"]);
            await this.checkOptionalHttpsPort(true);
            if (!existsSync(this.composeFile))
                return this.set({
                    state: "not-created",
                    message:
                        "Docker is available. Start Services to create the Vhostra runtime.",
                    services: [],
                });
            const output = await this.compose(
                ["ps", "--format", "json"],
                false,
            );
            const rows = parseJsonLines(output);
            const services = rows
                .map((row: { Service?: string }) => row.Service)
                .filter((value): value is string => Boolean(value));
            const running =
                rows.length > 0 &&
                rows.every(
                    (row: { State?: string }) => row.State === "running",
                );
            const state: RuntimeState = running ? "running" : "stopped";
            const snapshot = this.set({
                state,
                message: running
                    ? "Vhostra services are running."
                    : "Vhostra runtime is stopped.",
                services,
            });
            void this.reconcileHtaccessWatchers(running);
            return snapshot;
        } catch (error) {
            return this.set({
                state: "unavailable",
                message: dockerMessage(error),
                services: [],
            });
        }
    }
    async start() {
        return this.runExclusive(
            "starting",
            "Preparing Vhostra runtime…",
            async () => {
                this.set({
                    state: "starting",
                    message: "Checking Docker…",
                    services: [],
                });
                await this.requireDocker();
                const state = await this.getState();
                this.set({
                    state: "starting",
                    message: "Checking configured service ports…",
                    services: [],
                });
                await this.ensurePortsAvailable(requiredHostPorts(state), true);
                await this.checkOptionalHttpsPort(true);
                this.set({
                    state: "starting",
                    message: "Preparing persistent runtime configuration…",
                    services: [],
                });
                await this.generate(state);
                await this.compose(["config", "--quiet"]);
                this.set({
                    state: "starting",
                    message:
                        "Preparing a compatible Vhostra runtime image and container…",
                    services: ["runtime"],
                });
                // Never use Compose orphan removal during startup: candidate/replacement
                // promotion must retain the prior Vhostra runtime until it has been proven
                // healthy, and unrelated Compose projects are never in scope.
                await this.upCompatibleImage();
                this.set({
                    state: "starting",
                    message: "Configuring secure local phpMyAdmin access…",
                    services: ["runtime"],
                });
                await this.provisionPhpMyAdmin();
                this.set({
                    state: "starting",
                    message:
                        "Checking the selected web server, PHP, MariaDB, and phpMyAdmin…",
                    services: ["runtime"],
                });
                await this.healthCheck(state.settings.selectedWebServer);
                await this.cleanGenerated(state).catch(error => console.error("Generated cleanup deferred:", error.message));
                await fs.writeFile(
                    path.join(this.runtimeRoot, "healthy-state.json"),
                    JSON.stringify(state),
                    { mode: 0o600 },
                );
                await this.refresh();
                await this.cleanupImages().catch(error => console.error("Vhostra image cache cleanup deferred:", error.message));
            },
        );
    }
    async stop() {
        return this.runExclusive(
            "stopping",
            "Stopping Vhostra services…",
            async () => {
                await this.requireDocker();
                if (existsSync(this.composeFile)) await this.compose(["stop"]);
                await this.refresh();
            },
        );
    }
    async restart(preserveStopped = false) {
        const restoreStopped = preserveStopped && this.snapshot.state !== "running";
        return this.runExclusive(
            "stopping",
            "Restarting Vhostra services…",
            async () => {
                this.set({
                    state: "stopping",
                    message:
                        "Checking Docker and configured ports before runtime replacement…",
                    services: this.snapshot.services,
                });
                await this.requireDocker();
                const state = await this.getState();
                await this.ensurePortsAvailable(requiredHostPorts(state), true);
                await this.checkOptionalHttpsPort(true);
                let previous: AppState | null = null;
                try {
                    previous = JSON.parse(
                        await fs.readFile(
                            path.join(this.runtimeRoot, "healthy-state.json"),
                            "utf8",
                        ),
                    ) as AppState;
                } catch {
                    /* legacy runtime: first successful replacement establishes the snapshot */
                }
                const previousImage = (
                    await this.compose(["images", "--quiet", "runtime"])
                )
                    .trim()
                    .split("\n")[0];
                const recoveryTag = `vhostra-runtime:recovery-${randomBytes(8).toString("hex")}`;
                const backup = await fs.mkdtemp(
                    path.join(this.layout.backups, "runtime-recovery-"),
                );
                await fs.writeFile(path.join(backup, "recovery.json"), JSON.stringify({ owner: "vhostra", state: "active", image: previousImage,
                    recoveryTag, createdAt: new Date().toISOString(), source: this.runtimeRoot }), { mode: 0o600 });
                if (previousImage) await this.docker(["tag", previousImage, recoveryTag]);
                const candidateScope = `${this.scope}-candidate-${randomBytes(4).toString("hex")}`;
                let candidate: DockerRuntimeController | null = null;
                let candidateLineCount = 0;
                let recoveredOrPromoted = false;
                let candidateRemoved = true;
                try {
                    await fs.cp(
                        this.runtimeRoot,
                        path.join(backup, "runtime"),
                        { recursive: true, verbatimSymlinks: true },
                    );
                    await fs.cp(this.layout.configuration.generated, path.join(backup, "generated"), { recursive: true, verbatimSymlinks: true });
                    if (
                        previous &&
                        (previous.settings.selectedWebServer !==
                            state.settings.selectedWebServer ||
                            previous.settings.selectedPhpVersion !==
                                state.settings.selectedPhpVersion)
                    ) {
                        this.set({
                            state: "starting",
                            message:
                                "Verifying a candidate runtime before replacing the working services…",
                            services: ["runtime"],
                        });
                        // MariaDB files are copied only while its owning runtime is stopped.
                        await this.compose(["stop"]);
                        try {
                            await fs.cp(
                                this.layout.persistentData.mariaDb,
                                path.join(backup, "candidate-database"),
                                { recursive: true },
                            );
                        } finally {
                            await this.compose(["start"]);
                        }
                        const candidateLayout: StoreLayout = {
                            ...this.layout,
                            sites: path.join(backup, "candidate-sites"),
                            certificates: {
                                directory: path.join(
                                    backup,
                                    "candidate-certificates",
                                ),
                                public: path.join(
                                    backup,
                                    "candidate-certificates/public",
                                ),
                                private: path.join(
                                    backup,
                                    "candidate-certificates/private",
                                ),
                            },
                            runtime: Object.fromEntries(
                                Object.keys(this.layout.runtime).map((key) => [
                                    key,
                                    path.join(backup, "candidate", key),
                                ]),
                            ) as unknown as StoreLayout["runtime"],
                            persistentData: {
                                mariaDb: path.join(
                                    backup,
                                    "candidate-database",
                                ),
                            },
                            configuration: {
                                ...this.layout.configuration,
                                generated: path.join(
                                    backup,
                                    "candidate-generated",
                                ),
                            },
                            logs: path.join(backup, "candidate-logs"),
                        };
                        await fs.cp(this.layout.sites, candidateLayout.sites, {
                            recursive: true,
                        });
                        const http = await this.findAvailablePort(30000);
                        const phpMyAdmin = await this.findAvailablePort(http);
                        const mariadb =
                            await this.findAvailablePort(phpMyAdmin);
                        const https = await this.findAvailablePort(mariadb);
                        const candidateState: AppState = {
                            ...state,
                            settings: {
                                ...state.settings,
                                ports: {
                                    ...state.settings.ports,
                                    http,
                                    phpMyAdmin,
                                    mariadb,
                                    https,
                                },
                            },
                        };
                        candidateRemoved = false;
                        candidate = new DockerRuntimeController(
                            candidateLayout,
                            async () => candidateState,
                            undefined,
                            candidateScope,
                        );
                        candidate.subscribe(() => {
                            const next = candidate!.current().progress;
                            if (next) {
                                const lines = next.lines;
                                const seen = candidateLineCount;
                                candidateLineCount = next.total;
                                for (const line of lines.slice(Math.max(0, lines.length - (next.total - seen)))) this.appendProgress(`Candidate: ${line}`);
                            }
                        });
                        await candidate.start();
                        await candidate.stop();
                        await candidate.compose(["down"]);
                        candidateRemoved = true;
                    }
                    this.set({
                        state: "starting",
                        message: "Promoting verified runtime configuration…",
                        services: ["runtime"],
                    });
                    await this.generate(state);
                    await this.compose(["config", "--quiet"]);
                    await this.upCompatibleImage();
                    await this.provisionPhpMyAdmin();
                    await this.healthCheck(state.settings.selectedWebServer);
                    await fs.writeFile(
                        path.join(this.runtimeRoot, "healthy-state.json"),
                        JSON.stringify(state),
                        { mode: 0o600 },
                    );
                    if (restoreStopped) await this.compose(["stop"]);
                    await this.refresh();
                    await this.cleanGenerated(state).catch(error => console.error("Generated cleanup deferred:", error.message));
                    recoveredOrPromoted = true;
                } catch (error) {
                    this.set({ state: "starting", message: "Recovering runtime replacement; rolling back to verified configuration…", services: ["runtime"] });
                    this.appendProgress(`Replacement failed: ${error instanceof Error ? error.message : String(error)}`);
                    if (candidate) {
                        const output = await candidate.compose(["logs", "--no-color", "--tail", "60", "runtime"]).catch(() => "Candidate logs unavailable.");
                        for (const line of output.split(/\r?\n/)) this.appendProgress(`Candidate failure: ${line}`);
                    }
                    if (candidate)
                        await candidate
                            .compose(["down"])
                            .then(() => { candidateRemoved = true; })
                            .catch(() => { candidateRemoved = false; });
                    if (previous) {
                        try {
                            await this.compose(["stop"]).catch(() => undefined);
                            await fs.cp(
                                path.join(backup, "runtime"),
                                this.runtimeRoot,
                                { recursive: true, force: true },
                            );
                            await restoreGenerated(this.layout.configuration.generated, path.join(backup, "generated"));
                            await this.compose(["up", "--detach", "--no-build"]);
                            await this.provisionPhpMyAdmin();
                            await this.healthCheck(
                                previous.settings.selectedWebServer,
                                previous,
                            );
                            if (restoreStopped) await this.compose(["stop"]);
                            recoveredOrPromoted = true;
                        } catch (recoveryError) {
                            throw new Error(`Runtime replacement failed: ${error instanceof Error ? error.message : String(error)}. Runtime replacement and recovery failed. Recovery files were retained at ${backup}. ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`);
                        }
                        throw new Error(
                            `Runtime replacement rolled back to the verified previous configuration. ${error instanceof Error ? error.message : String(error)}`,
                        );
                    }
                    throw error;
                } finally {
                    candidate?.dispose();
                    if (recoveredOrPromoted && candidateRemoved) {
                        try { await fs.rm(backup, { recursive: true, force: true });
                        if (previousImage) await this.docker(["image", "rm", recoveryTag]);
                        await this.cleanupImages();
                        } catch (error) { console.error(`Vhostra recovery cleanup deferred at ${backup}: ${error instanceof Error ? error.message : String(error)}`); }
                    }
                    else
                        console.error(`Vhostra retained runtime recovery files at ${backup}; recovery or candidate removal was incomplete.`);
                }
            },
        );
    }
    async applyConfiguration() {
        const before = this.snapshot.state;
        if (before === "running") return this.restart();
        if (existsSync(this.composeFile) && existsSync(path.join(this.runtimeRoot, "healthy-state.json"))) return this.restart(true);
        return this.refresh();
    }
    async checkPort(port: number) {
        validatePort(port);
        if (!(await isPortOccupied(port)))
            return { port, available: true, owner: null as string | null };
        if (await this.vhostraOwnsPort(port))
            return { port, available: false, owner: "Vhostra" };
        return { port, available: false, owner: await describePort(port) };
    }
    async findAvailablePort(start: number) {
        validatePort(start);
        for (let port = Math.max(1025, start + 1); port <= 65535; port += 1)
            if (!(await isPortOccupied(port))) return port;
        throw new Error("No available TCP port was found.");
    }
    async reloadWebServer() {
        return this.runExclusive(
            "starting",
            "Reloading OpenLiteSpeed rewrite configuration…",
            async () => {
                await this.requireDocker();
                const state = await this.getState();
                if (state.settings.selectedWebServer !== "openlitespeed")
                    throw new Error(
                        "A graceful reload is currently available for the OpenLiteSpeed runtime only.",
                    );
                await this.compose([
                    "exec",
                    "-T",
                    "runtime",
                    "/usr/local/lsws/bin/lswsctrl",
                    "reload",
                ]);
                await this.healthCheck("openlitespeed");
                await this.refresh();
            },
        );
    }
    async setOpenLiteSpeedRewrite(enabled: boolean) {
        const wasRunning = this.snapshot.state === "running";
        return this.runExclusive(
            "starting",
            `${enabled ? "Enabling" : "Disabling"} OpenLiteSpeed rewrite support…`,
            async () => {
                await this.requireDocker();
                const state = await this.getState();
                if (
                    state.settings.selectedWebServer !== "openlitespeed" ||
                    !wasRunning
                ) {
                    await this.generate(state);
                    if (wasRunning)
                        await this.compose([
                            "exec",
                            "-T",
                            "runtime",
                            "supervisorctl",
                            "restart",
                            "web",
                        ]);
                    await this.refresh();
                    return;
                }
                const value = enabled ? "1" : "0";
                const command = `/usr/bin/sed -Ei '/^rewrite[[:space:]]*\\{/,/^\\}/ s/^[[:space:]]*enable[[:space:]]+[01][[:space:]]*$/  enable ${value}/' /usr/local/lsws/conf/vhosts/Example/vhconf.conf && /usr/local/lsws/bin/lswsctrl reload`;
                await this.compose([
                    "exec",
                    "-T",
                    "runtime",
                    "/bin/sh",
                    "-lc",
                    command,
                ]);
                await this.healthCheck("openlitespeed");
                await this.refresh();
            },
        );
    }
    async listDatabases() {
        await this.requireDocker();
        const output = await this.compose([
            "exec",
            "-T",
            "runtime",
            "mariadb",
            "-uroot",
            "-N",
            "-e",
            "SHOW DATABASES",
        ]);
        return output
            .split("\n")
            .map((name) => name.trim())
            .filter(
                (name) =>
                    name &&
                    ![
                        "information_schema",
                        "mysql",
                        "performance_schema",
                        "sys",
                    ].includes(name),
            );
    }
    async listManagedServices(): Promise<ManagedServiceStatus[]> {
        const state = await this.getState();
        if (this.snapshot.state !== "running")
            return [
                {
                    id: "web",
                    label:
                        state.settings.selectedWebServer === "openlitespeed"
                            ? "OpenLiteSpeed"
                            : state.settings.selectedWebServer === "apache"
                              ? "Apache"
                              : "Nginx",
                    enabled: true,
                    state:
                        this.snapshot.state === "unavailable"
                            ? "unavailable"
                            : "stopped",
                },
                {
                    id: "mariadb",
                    label: "MariaDB",
                    enabled: true,
                    state:
                        this.snapshot.state === "unavailable"
                            ? "unavailable"
                            : "stopped",
                },
                {
                    id: "redis",
                    label: "Redis",
                    enabled: state.settings.optionalServices.redis,
                    state: state.settings.optionalServices.redis
                        ? "stopped"
                        : "disabled",
                },
                {
                    id: "memcached",
                    label: "Memcached",
                    enabled: state.settings.optionalServices.memcached,
                    state: state.settings.optionalServices.memcached
                        ? "stopped"
                        : "disabled",
                },
            ];
        const output = await this.compose(
            ["exec", "-T", "runtime", "supervisorctl", "status"],
            true,
        );
        const rows = new Map(
            output
                .split("\n")
                .filter(Boolean)
                .map((line) => {
                    const [name, status] = line.trim().split(/\s+/, 2);
                    return [name, status];
                }),
        );
        const supervisorState = (
            name: string,
        ): ManagedServiceStatus["state"] => {
            const value = rows.get(name) ?? "";
            if (value === "RUNNING") return "running";
            if (value === "STARTING") return "starting";
            if (value === "STOPPED" || value === "EXITED") return "stopped";
            return "failed";
        };
        return [
            {
                id: "web",
                label:
                    state.settings.selectedWebServer === "openlitespeed"
                        ? "OpenLiteSpeed"
                        : state.settings.selectedWebServer === "apache"
                          ? "Apache"
                          : "Nginx",
                enabled: true,
                state: supervisorState("web"),
            },
            {
                id: "mariadb",
                label: "MariaDB",
                enabled: true,
                state: supervisorState("mariadb"),
            },
            {
                id: "redis",
                label: "Redis",
                enabled: state.settings.optionalServices.redis,
                state: state.settings.optionalServices.redis
                    ? supervisorState("redis")
                    : "disabled",
            },
            {
                id: "memcached",
                label: "Memcached",
                enabled: state.settings.optionalServices.memcached,
                state: state.settings.optionalServices.memcached
                    ? supervisorState("memcached")
                    : "disabled",
            },
        ];
    }
    async controlManagedService(
        id: ManagedServiceStatus["id"],
        action: "start" | "stop" | "restart",
    ) {
        const state = await this.getState();
        const name = id === "web" ? "web" : id;
        if (
            (id === "redis" && !state.settings.optionalServices.redis) ||
            (id === "memcached" && !state.settings.optionalServices.memcached)
        )
            throw new Error(
                `${id === "redis" ? "Redis" : "Memcached"} is disabled in Vhostra Settings.`,
            );
        // Check the container before runExclusive changes the public snapshot to a
        // transitional state. Otherwise every individual action observes its own
        // “starting” state and is incorrectly rejected.
        await this.refresh();
        if (this.snapshot.state !== "running")
            throw new Error(
                "Start the Vhostra runtime before controlling an individual service.",
            );
        return this.runExclusive(
            action === "stop" ? "stopping" : "starting",
            `${actionLabel(action)} ${id === "web" ? "the active web server" : id}…`,
            async () => {
                await this.requireDocker();
                await this.compose([
                    "exec",
                    "-T",
                    "runtime",
                    "supervisorctl",
                    action,
                    name,
                    ...(id === "web" && state.settings.selectedWebServer !== "openlitespeed" ? ["php-backend"] : []),
                ]);
                if (id === "web" && action === "stop" && state.settings.selectedWebServer === "openlitespeed")
                    await this.compose(["exec", "-T", "runtime", "/bin/sh", "-lc", "pkill -x lsphp || true"]);
                if (id === "web" && action !== "stop")
                    await this.healthCheck(state.settings.selectedWebServer);
                if (id === "mariadb" && action !== "stop")
                    await this.compose([
                        "exec",
                        "-T",
                        "runtime",
                        "mariadb",
                        "-uroot",
                        "-e",
                        "SELECT 1",
                    ]);
                if (id === "redis" && action !== "stop")
                    await this.compose([
                        "exec",
                        "-T",
                        "runtime",
                        "redis-cli",
                        "PING",
                    ]);
                if (id === "memcached" && action !== "stop")
                    await this.compose([
                        "exec",
                        "-T",
                        "runtime",
                        "/bin/sh",
                        "-lc",
                        "printf 'version\\r\\n' | nc -w 3 127.0.0.1 11211 | grep -q '^VERSION'",
                    ]);
                await this.refresh();
                return this.listManagedServices();
            },
        );
    }
    dispose() {
        this.disposed = true;
        clearTimeout(this.progressNotification); this.progressNotification = undefined;
        this.clearHtaccessWatchers();
        this.listeners.clear();
    }
    async listPhpExtensions() {
        const state = await this.getState();
        const selected = new Set(state.settings.php.extensions);
        const required = new Set(["mysqli", "pdo-mysql", "mysql"]);
        const disabled = new Set(state.settings.php.disabledExtensions);
        const configured = new Set([
            "opcache",
            "redis",
            "memcached",
            ...selected,
            ...disabled,
        ]);
        if (this.snapshot.state !== "running")
            return [...configured]
                .sort()
                .map((id) => ({
                    id,
                    label: extensionLabel(id),
                    required: required.has(id),
                    enabled:
                        id === "opcache"
                            ? state.settings.php.opcacheEnabled
                            : selected.has(id) ||
                              (id === "redis" &&
                                  state.settings.optionalServices.redis) ||
                              (id === "memcached" &&
                                  state.settings.optionalServices.memcached),
                    installed: false,
                    category: required.has(id) ? "required" : "selected",
                    status: "Selected — start the runtime to discover its complete package catalog and actual module state.",
                }));
        const raw = await requestLocalHttp(
            state.settings.ports.http,
            "/vhostra-extension-state.php",
        );
        const loaded = new Set(parseHttpJson<string[]>(raw) ?? []);
        const extensionFlags = await requestLocalHttp(state.settings.ports.http, "/vhostra-extensions.php");
        const available: string[] = await this.availablePhpPackages().catch(
            (): string[] => [],
        );
        const packageInstalled = new Set(
            await this.installedPhpPackages().catch(() => []),
        );
        const all = new Set(
            [...available, ...loaded].map(normalizeExtensionId).filter(Boolean),
        );
        for (const id of configured) all.add(id);
        for (const id of required) all.add(id);
        return [...all]
            .sort((a, b) => extensionLabel(a).localeCompare(extensionLabel(b)))
            .map((id) => {
                const actual =
                    id === "opcache"
                        ? loaded.has("Zend OPcache") && extensionFlags.includes("opcache:1")
                        : id === "mysql"
                          ? loaded.has("mysqli") && loaded.has("pdo_mysql")
                          : [...loaded].map(normalizeExtensionId).includes(id);
                const dependency =
                    (id === "redis" && state.settings.optionalServices.redis) ||
                    (id === "memcached" &&
                        state.settings.optionalServices.memcached);
                const isRequired = required.has(id);
                const managedPackage = packageInstalled.has(id);
                const installed = managedPackage || actual || (id === "opcache" && loaded.has("Zend OPcache"));
                const enabled = actual;
                const supported =
                    available.includes(id) ||
                    actual ||
                    isRequired ||
                    dependency ||
                    id === "opcache";
                const category = isRequired
                    ? "required"
                    : dependency || id === "redis" || id === "memcached"
                      ? "dependency-managed"
                      : !supported
                        ? "unsupported"
                        : actual && !managedPackage
                          ? "core"
                          : actual
                            ? "installed-enabled"
                            : installed
                              ? "installed-disabled"
                              : "available";
                return {
                    id,
                    label: extensionLabel(id),
                    required: isRequired,
                    enabled,
                    installed,
                    category,
                    status: isRequired
                        ? "Required by Vhostra"
                        : dependency || id === "redis" || id === "memcached"
                          ? `Managed with the matching service in Services — ${actual ? "enabled" : "disabled"}`
                          : !supported
                            ? "Unsupported or unavailable for the selected LSPHP version"
                            : actual && !managedPackage
                              ? "Built-in/Core"
                              : actual
                                ? "Installed and enabled"
                                : installed
                                  ? "Installed but disabled"
                                  : "Available to install",
                };
            });
    }
    /** Installs or removes one catalogued optional LSPHP package in the running
     * Vhostra container, then verifies the package/module state before returning.
     * Core, required, and dependency-managed entries are deliberately protected. */
    async managePhpExtension(
        id: string,
        action: "install" | "enable" | "disable" | "remove",
    ) {
        const extension = normalizeExtensionId(id);
        if (!/^[a-z0-9][a-z0-9-]*$/.test(extension))
            throw new Error("Invalid PHP extension identifier.");
        if (
            [
                "mysqli",
                "pdo-mysql",
                "pdo_mysql",
                "mysql",
                "opcache",
                "redis",
                "memcached",
            ].includes(extension)
        )
            throw new Error(
                `${extensionLabel(extension)} is required or dependency-managed and cannot be changed here.`,
            );
        if (this.snapshot.state !== "running")
            throw new Error(
                "Start the Vhostra runtime before changing PHP extensions.",
            );
        const available = new Set(await this.availablePhpPackages());
        if (!available.has(extension))
            throw new Error(
                `${extensionLabel(extension)} is not an installable extension package for the selected LSPHP version.`,
            );
        const state = await this.getState();
        const php = state.settings.selectedPhpVersion.replace(".", "");
        const packageName = `lsphp${php}-${extension}`;
        return this.runExclusive(
            "starting",
            `${actionLabel(action)} PHP extension ${extensionLabel(extension)}…`,
            async () => {
                if (action === "install" || action === "enable") {
                    if (!(await this.installedPhpPackages()).includes(extension)) await this.compose([
                        "exec",
                        "-T",
                        "runtime",
                        "/bin/sh",
                        "-lc",
                        `DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ${packageName} && apt-get clean && rm -rf /var/lib/apt/lists/*`,
                    ]);
                    // Package-maintained extension INI files are normally enabled by default.
                    // Where one is explicitly disabled, restore its exact package module line.
                    await this.configureRuntimePhpExtension(
                        php,
                        extension,
                        true,
                    );
                } else if (action === "disable") {
                    const output = await this.compose([
                        "exec",
                        "-T",
                        "runtime",
                        "/bin/sh",
                        "-lc",
                        `find /usr/local/lsws/lsphp${php} -path '*/mods-available/*${extension}*.ini' -type f -print -quit`,
                    ]);
                    if (!output.trim())
                        throw new Error(
                            `${extensionLabel(extension)} has no independently disableable module configuration.`,
                        );
                    await this.configureRuntimePhpExtension(
                        php,
                        extension,
                        false,
                    );
                } else {
                    const plan = await this.compose(["exec", "-T", "runtime", "/bin/sh", "-lc", `apt-get --simulate purge ${packageName}`]);
                    const removals = plan.split(/\r?\n/).filter(line => /^Remv\s/.test(line)).map(line => line.split(/\s+/)[1]);
                    const dependencies = removals.filter(name => name !== packageName);
                    if (dependencies.length) throw new Error(`Cannot remove ${extensionLabel(extension)} because other installed packages depend on it: ${dependencies.join(", ")}. No packages were removed.`);
                    await this.configureRuntimePhpExtension(php, extension, false);
                    await this.compose(["exec", "-T", "runtime", "/bin/sh", "-lc", `DEBIAN_FRONTEND=noninteractive apt-get purge -y ${packageName}`]);
                }
                await this.compose([
                    "exec",
                    "-T",
                    "runtime",
                    "supervisorctl",
                    "restart",
                    "web",
                    ...(state.settings.selectedWebServer !== "openlitespeed" ? ["php-backend"] : []),
                ]);
                // LSAPI workers survive a parent restart on some OLS builds. They are
                // Vhostra-owned children inside this container, so retire them to force
                // the selected LSPHP php.ini to be read on the next request.
                await this.compose([
                    "exec",
                    "-T",
                    "runtime",
                    "/bin/sh",
                    "-lc",
                    "pkill -u nobody -x lsphp || true",
                ]);
                const installed =
                    (
                        await this.compose([
                            "exec",
                            "-T",
                            "runtime",
                            "/bin/sh",
                            "-lc",
                            `dpkg-query -W -f='${"${db:Status-Status}"}' ${packageName} 2>/dev/null || true`,
                        ])
                    ).trim() === "installed";
                if ((action === "install" || action === "enable") && !installed)
                    throw new Error(
                        `${extensionLabel(extension)} package installation could not be verified.`,
                    );
                if (action === "remove" && installed)
                    throw new Error(
                        `${extensionLabel(extension)} package removal could not be verified.`,
                    );
                const raw = await requestLocalHttp(
                    state.settings.ports.http,
                    "/vhostra-extension-state.php",
                );
                const loaded = new Set(
                    (parseHttpJson<string[]>(raw) ?? []).map(
                        normalizeExtensionId,
                    ),
                );
                if (
                    (action === "install" || action === "enable") &&
                    !loaded.has(extension)
                )
                    throw new Error(
                        `${extensionLabel(extension)} package changed, but the selected LSPHP web runtime did not load it.`,
                    );
                if (
                    (action === "disable" || action === "remove") &&
                    loaded.has(extension)
                )
                    throw new Error(
                        `${extensionLabel(extension)} is still loaded by the selected LSPHP web runtime.`,
                    );
                await this.refresh();
                return this.listPhpExtensions();
            },
        );
    }
    async getCwebpStatus() {
        const enabled = (await this.getState()).settings.php.cwebpEnabled;
        if (this.snapshot.state !== "running")
            return { enabled, installed: false };
        const version = await this.compose(
            [
                "exec",
                "-T",
                "runtime",
                "/bin/sh",
                "-lc",
                "command -v cwebp >/dev/null && cwebp -version",
            ],
            true,
        );
        return {
            enabled,
            installed: Boolean(version.trim()),
            ...(version.trim()
                ? { version: version.trim().split("\n")[0] }
                : {}),
        };
    }
    async configureCwebp(enabled: boolean) {
        if (this.snapshot.state !== "running")
            throw new Error("Start the Vhostra runtime before changing cwebp.");
        return this.runExclusive(
            "starting",
            `${enabled ? "Installing" : "Removing"} cwebp…`,
            async () => {
                await this.compose([
                    "exec",
                    "-T",
                    "runtime",
                    "/bin/sh",
                    "-lc",
                    enabled
                        ? "DEBIAN_FRONTEND=noninteractive apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y webp"
                        : "DEBIAN_FRONTEND=noninteractive apt-get purge -y webp",
                ]);
                const output = await this.compose(
                    [
                        "exec",
                        "-T",
                        "runtime",
                        "/bin/sh",
                        "-lc",
                        "command -v cwebp >/dev/null && cwebp -version",
                    ],
                    true,
                );
                const status = {
                    enabled,
                    installed: Boolean(output.trim()),
                    ...(output.trim()
                        ? { version: output.trim().split("\n")[0] }
                        : {}),
                };
                if (enabled && !status.installed)
                    throw new Error(
                        "cwebp installation could not be verified.",
                    );
                if (!enabled && status.installed)
                    throw new Error("cwebp removal could not be verified.");
                await this.refresh();
                return status;
            },
        );
    }
    async createDatabase(input: {
        name: string;
        charset: string;
        username: string;
        password: string;
    }) {
        const name = sqlIdentifier(input.name, "database name");
        const username = sqlIdentifier(input.username, "username");
        if (!["utf8mb4", "utf8", "latin1"].includes(input.charset))
            throw new Error("Unsupported MariaDB character set.");
        if (input.password.length < 12)
            throw new Error(
                "Database passwords must contain at least 12 characters.",
            );
        this.secrets.add(input.password);
        const password = sqlLiteral(input.password);
        const sql = `CREATE DATABASE \`${name}\` CHARACTER SET ${input.charset}; CREATE USER '${username}'@'%' IDENTIFIED BY ${password}; GRANT ALL PRIVILEGES ON \`${name}\`.* TO '${username}'@'%'; FLUSH PRIVILEGES;`;
        await this.compose([
            "exec",
            "-T",
            "runtime",
            "mariadb",
            "-uroot",
            "-e",
            sql,
        ]);
        const state = await this.getState();
        return {
            name,
            username,
            host: "127.0.0.1",
            port: state.settings.ports.mariadb,
            charset: input.charset,
        };
    }
    async phpMyAdminUrl(database?: string) {
        const state = await this.getState();
        if (this.snapshot.state !== "running")
            throw new Error(
                "Start the Vhostra runtime before opening phpMyAdmin.",
            );
        const query = database
            ? `?db=${encodeURIComponent(sqlIdentifier(database, "database name"))}`
            : "";
        return `http://localhost:${state.settings.ports.phpMyAdmin}/phpmyadmin/index.php${query}`;
    }
    async importDatabase(name: string, source: string) {
        const database = sqlIdentifier(name, "database name");
        if (path.extname(source).toLowerCase() !== ".sql")
            throw new Error("Choose an uncompressed .sql database dump.");
        await fs.access(source);
        return this.runDatabaseOperation(`Importing ${database}…`, async () => {
            await executeWithInput(
                "docker",
                this.composeArguments([
                    "exec",
                    "-T",
                    "runtime",
                    "mariadb",
                    "-uroot",
                    database,
                ]),
                source,
            );
            return {
                database,
                message: `Imported ${path.basename(source)} into ${database}.`,
            };
        });
    }
    async exportDatabase(name: string, destination: string) {
        const database = sqlIdentifier(name, "database name");
        if (path.extname(destination).toLowerCase() !== ".sql")
            throw new Error("Database exports must use a .sql filename.");
        return this.runDatabaseOperation(`Exporting ${database}…`, async () => {
            await executeWithOutput(
                "docker",
                this.composeArguments([
                    "exec",
                    "-T",
                    "runtime",
                    "mariadb-dump",
                    "-uroot",
                    "--single-transaction",
                    "--routines",
                    "--events",
                    database,
                ]),
                destination,
            );
            return {
                database,
                message: `Exported ${database} to ${path.basename(destination)}.`,
            };
        });
    }
    async repairDatabase(name: string) {
        const database = sqlIdentifier(name, "database name");
        return this.runDatabaseOperation(
            `Checking ${database} tables…`,
            async () => {
                const rows = (
                    await this.compose([
                        "exec",
                        "-T",
                        "runtime",
                        "mariadb",
                        "-uroot",
                        "-N",
                        "-e",
                        `SELECT TABLE_NAME, COALESCE(ENGINE, '') FROM information_schema.TABLES WHERE TABLE_SCHEMA=${sqlLiteral(database)} AND TABLE_TYPE='BASE TABLE'`,
                    ])
                )
                    .split("\n")
                    .filter(Boolean)
                    .map((line) => line.split("\t"));
                const results: string[] = [];
                for (const [table, engine] of rows) {
                    if (engine === "MyISAM" || engine === "Aria") {
                        await this.compose([
                            "exec",
                            "-T",
                            "runtime",
                            "mariadb",
                            "-uroot",
                            "-e",
                            `REPAIR TABLE \`${database}\`.\`${table}\``,
                        ]);
                        results.push(`${table}: repaired (${engine})`);
                    } else {
                        await this.compose([
                            "exec",
                            "-T",
                            "runtime",
                            "mariadb",
                            "-uroot",
                            "-e",
                            `CHECK TABLE \`${database}\`.\`${table}\``,
                        ]);
                        results.push(
                            `${table}: checked (${engine || "unknown engine"}; no table repair attempted)`,
                        );
                    }
                }
                return {
                    database,
                    message: results.length
                        ? results.join("; ")
                        : "No base tables to check.",
                };
            },
        );
    }
    async deleteDatabase(name: string) {
        const database = sqlIdentifier(name, "database name");
        return this.runDatabaseOperation(`Deleting ${database}…`, async () => {
            await this.compose([
                "exec",
                "-T",
                "runtime",
                "mariadb",
                "-uroot",
                "-e",
                `DROP DATABASE \`${database}\``,
            ]);
            return {
                database,
                message: `Deleted ${database}. Database users were not changed.`,
            };
        });
    }

    private get runtimeRoot() {
        return path.dirname(this.layout.runtime.apache);
    }
    private get composeFile() {
        return path.join(this.runtimeRoot, "compose.yml");
    }
    private get environmentFile() {
        return path.join(this.runtimeRoot, ".env");
    }
    private appendProgress(text: string, notify = true) {
        if (!this.progress) return;
        const safeLines: string[] = [];
        for (const line of text.split(/\r?\n/)) {
            if (/-----BEGIN [^-]*(?:PRIVATE KEY|CERTIFICATE)-----/.test(line)) this.hiddenProgressMaterial = true;
            if (this.hiddenProgressMaterial) {
                if (/-----END [^-]+-----/.test(line)) this.hiddenProgressMaterial = false;
                continue;
            }
            safeLines.push(line);
        }
        const lines = redactProgress(safeLines.join("\n"), this.secrets).split(/\r?\n/).filter(line => line.trim());
        this.progress.total += lines.length;
        this.progress.lines = [...this.progress.lines, ...lines.map(line => line.slice(0, 2000))].slice(-300);
        this.snapshot = { ...this.snapshot, progress: { ...this.progress, lines: [...this.progress.lines] } };
        if (notify && !this.progressNotification) this.progressNotification = setTimeout(() => {
            this.progressNotification = undefined;
            if (this.progress && !this.disposed) this.listeners.forEach(listener => listener());
        }, 50);
    }
    private set(next: Omit<RuntimeSnapshot, "updatedAt">) {
        const message = this.httpsWarning
            ? `${next.message} HTTPS is unavailable: ${this.httpsWarning}`
            : next.message;
        this.appendProgress(message, false);
        clearTimeout(this.progressNotification); this.progressNotification = undefined;
        this.snapshot = {
            ...next,
            progress: this.progress ? { ...this.progress, lines: [...this.progress.lines] } : undefined,
            message: redactProgress(message, this.secrets),
            updatedAt: new Date().toISOString(),
        };
        const welcomeMessage = this.snapshot.message;
        this.welcomeWrites = this.welcomeWrites.then(async () => { await this.updateWelcome?.(welcomeMessage); })
            .catch(error => { console.error("Vhostra welcome update failed:", redactProgress(error instanceof Error ? error.message : String(error), this.secrets)); });
        this.listeners.forEach((listener) => listener());
        return this.snapshot;
    }
    private async runExclusive<T>(
        state: RuntimeState,
        message: string,
        task: () => Promise<T>,
    ): Promise<T> {
        if (this.operation)
            throw new Error(
                "A Vhostra service operation is already in progress.",
            );
        this.counters.operations++;
        this.hiddenProgressMaterial = false;
        this.progress = { id: ++progressSequence, lines: [], total: 0 };
        this.set({ state, message, services: this.snapshot.services });
        const result = Promise.resolve().then(async () => {
            try {
                const environment = await fs.readFile(this.environmentFile, "utf8");
                for (const line of environment.split(/\r?\n/)) {
                    const match = line.match(/^[^#=]*(?:PASSWORD|SECRET|TOKEN|KEY)[^=]*=(.*)$/i);
                    if (match) this.secrets.add(match[1].replace(/^['"]|['"]$/g, ""));
                }
            } catch { /* first start has no credentials yet */ }
            return task();
        }).catch((error) => {
            this.set({
                state: "error",
                message: error instanceof Error ? error.message : String(error),
                services: [],
            });
            throw new Error(redactProgress(error instanceof Error ? error.message : String(error), this.secrets));
        });
        this.operation = result
            .then(
                () => undefined,
                () => undefined,
            )
            .finally(() => {
                this.operation = null;
                clearTimeout(this.progressNotification); this.progressNotification = undefined;
                this.progress = undefined;
                this.snapshot = { ...this.snapshot, progress: undefined };
                this.listeners.forEach(listener => listener());
            });
        return result;
    }
    /** Delete only unused, labeled build-cache images. Never containers/volumes/data.
     * Recovery tags lease old images until the corresponding transaction succeeds. */
    async cleanupImages() {
        const ids = (await this.docker(["image", "ls", "--filter", `label=${managedLabel}`,
            "--filter", "label=com.vhostra.purpose=runtime-image", "--quiet", "--no-trunc"])).trim().split(/\s+/).filter(Boolean);
        if (!ids.length) return;
        const images = JSON.parse(await this.docker(["image", "inspect", ...new Set(ids)])) as Array<{
            Id: string; Created: string; RepoTags?: string[]; Config?: { Labels?: Record<string, string> };
        }>;
        const containers = (await this.docker(["ps", "--all", "--quiet"])).trim().split(/\s+/).filter(Boolean);
        const used = new Set<string>(containers.length ? JSON.parse(await this.docker(["inspect", ...containers])).map((row: { Image: string }) => row.Image) : []);
        const sorted = images.sort((a, b) => b.Created.localeCompare(a.Created));
        for (const image of sorted.slice(6)) {
            const tags = image.RepoTags ?? [];
            if (used.has(image.Id) || image.Config?.Labels?.["com.vhostra.managed"] !== "true"
                || image.Config.Labels["com.vhostra.purpose"] !== "runtime-image" || !tags.length
                || tags.some(tag => !/^vhostra-runtime:build-[a-f0-9]{24}$/.test(tag)) || tags.includes(this.imageName)) continue;
            // No force; Docker refuses images that acquire container references.
            await this.docker(["image", "rm", ...tags]);
        }
    }
    private async upCompatibleImage() {
        // Tags encode the complete build inputs, independent of candidate/test scope.
        const exists = await this.docker(["image", "ls", "--quiet", "--filter", `reference=${this.imageName}`]);
        let compatible = false;
        if (exists.trim()) {
            const images = JSON.parse(await this.docker(["image", "inspect", this.imageName]));
            const labels = images[0]?.Config?.Labels;
            compatible = labels?.["com.vhostra.managed"] === "true" && labels["com.vhostra.purpose"] === "runtime-image";
            if (!compatible) throw new Error("The compatible runtime tag is owned by an unrecognized image; refusing to overwrite it.");
        }
        if (!compatible) { this.counters.builds++; await this.compose(["build", "runtime"]); }
        await this.compose(["up", "--detach", "--no-build", "--pull", "never"]);
    }
    private async requireDocker() {
        await this.docker(["info"]);
        this.appendProgress("✓ Docker runtime available");
    }
    private async generate(state: AppState) {
        const hostname = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
        const names = new Set<string>();
        for (const host of state.virtualHosts) {
            if (!/^(?:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|vhostra-localhost-vhost)$/i.test(host.id) || !Array.isArray(host.aliases)
                || [host.hostname, ...host.aliases].some(name => typeof name !== 'string' || !hostname.test(name))
                || !path.isAbsolute(host.documentRoot) || /[\r\n\0]/.test(host.documentRoot)
                || (host.indexFiles && (!Array.isArray(host.indexFiles) || !host.indexFiles.length || host.indexFiles.length > 16 || host.indexFiles.some(index => typeof index !== 'string' || !/^[a-z0-9_.-]+$/i.test(index))))) throw new Error('Invalid canonical virtual-host fields; repair the definition before generating native configuration.');
            for (const name of [host.hostname, ...host.aliases]) { if (names.has(name.toLowerCase())) throw new Error(`Canonical hostname collision: ${name}`); names.add(name.toLowerCase()); }
            const site = state.sites.find(site => site.vhostId === host.id);
            if (!site || site.documentRoot !== host.documentRoot) throw new Error(`Canonical site and virtual-host roots disagree for ${host.hostname}.`);
        }
        this.resourceStorageCache = null;
        await fs.mkdir(this.runtimeRoot, { recursive: true });
        await Promise.all(
            [
                this.layout.runtime.apache,
                this.layout.runtime.nginx,
                this.layout.runtime.openLiteSpeed,
                this.layout.runtime.php,
                this.layout.runtime.mariaDb,
                this.layout.runtime.phpMyAdmin,
                this.layout.runtime.redis,
                this.layout.runtime.memcached,
                this.layout.logs,
            ].map((directory) => fs.mkdir(directory, { recursive: true })),
        );
        await this.ensureEnvironment();
        await Promise.all([
            fs.writeFile(
                path.join(
                    this.layout.sites,
                    "localhost",
                    "public",
                    "vhostra-health.php",
                ),
                '<?php echo "vhostra-lsphp:" . PHP_VERSION;\n',
                { mode: 0o600 },
            ),
            fs.writeFile(
                path.join(
                    this.layout.sites,
                    "localhost",
                    "public",
                    "vhostra-extensions.php",
                ),
                '<?php foreach (["mysqli", "pdo_mysql", "redis", "memcached"] as $extension) { echo $extension . ":" . (extension_loaded($extension) ? "1" : "0") . "\\n"; } echo "opcache:" . ((function_exists("opcache_get_status") && ini_get("opcache.enable")) ? "1" : "0") . "\\n";\n',
                { mode: 0o600 },
            ),
            fs.writeFile(
                path.join(
                    this.layout.sites,
                    "localhost",
                    "public",
                    "vhostra-extension-state.php",
                ),
                '<?php header("Content-Type: application/json"); echo json_encode(get_loaded_extensions());\n',
                { mode: 0o600 },
            ),
        ]);
        const mounts = state.virtualHosts.map((host) => ({
            host,
            container:
                host.builtIn === "localhost"
                    ? "/var/www/html"
                    : `/var/www/vhostra/${host.id}`,
        }));
        await Promise.all([
            fs.writeFile(
                path.join(this.layout.runtime.php, "vhostra.ini"),
                "expose_php=Off\nlog_errors=On\nerror_log=/dev/stderr\n",
                { mode: 0o600 },
            ),
            fs.writeFile(
                path.join(this.layout.runtime.mariaDb, "vhostra.cnf"),
                "[mariadb]\nskip-name-resolve\ninnodb_buffer_pool_size=64M\nmax_connections=50\nthread_cache_size=4\ntable_open_cache=400\ntmp_table_size=16M\nmax_heap_table_size=16M\nmax_allowed_packet=64M\nperformance_schema=OFF\n",
                { mode: 0o600 },
            ),
            fs.writeFile(
                path.join(this.layout.runtime.phpMyAdmin, "README.txt"),
                "phpMyAdmin is configured by the generated Vhostra Compose project.\n",
                { mode: 0o600 },
            ),
            fs.writeFile(
                path.join(this.layout.runtime.redis, "redis.conf"),
                "bind 127.0.0.1\nprotected-mode yes\nappendonly no\nsave \"\"\nmaxmemory 64mb\nmaxmemory-policy allkeys-lru\n",
                { mode: 0o600 },
            ),
            fs.writeFile(
                path.join(this.layout.runtime.memcached, "memcached.conf"),
                "-m 64\n",
                { mode: 0o600 },
            ),
        ]);
        await fs.writeFile(path.join(this.layout.runtime.php, "roots.json"), JSON.stringify(Object.fromEntries(
            mounts.flatMap(({ host, container }) => [host.hostname, ...host.aliases].map(name => [name.toLowerCase(), container])))), { mode: 0o644 });
        await this.writeServerConfiguration(
            state.settings.selectedWebServer,
            state.settings.selectedPhpVersion,
            mounts,
        );
        await fs.writeFile(
            path.join(this.layout.runtime.nginx, "tls-gateway.conf"),
            "pid /run/vhostra-tls.pid;\nevents {}\nhttp {\n  access_log /var/log/vhostra/https-access.log;\n  error_log /var/log/vhostra/https-error.log;\n  server {\n    listen 8443 ssl;\n    ssl_certificate /etc/vhostra/certificates/public/localhost.pem;\n    ssl_certificate_key /etc/vhostra/certificates/private/localhost.key;\n    ssl_protocols TLSv1.2 TLSv1.3;\n    location / { proxy_set_header Host $http_host; proxy_set_header X-Forwarded-Proto https; proxy_pass http://127.0.0.1:8088; }\n  }\n}\n",
            { mode: 0o600 },
        );
        await fs.cp(
            existsSync(fileURLToPath(new URL("../runtime-image/", import.meta.url)))
                ? fileURLToPath(new URL("../runtime-image/", import.meta.url))
                : path.join(process.resourcesPath, "runtime-image"),
            path.join(this.runtimeRoot, "image"),
            { recursive: true, force: true },
        );
        const hash = createHash("sha256");
        const imageRoot = path.join(this.runtimeRoot, "image");
        const hashFiles = async (directory: string): Promise<void> => {
            for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
                const file = path.join(directory, entry.name);
                if (entry.isDirectory()) await hashFiles(file);
                else if (entry.isFile()) { hash.update(path.relative(imageRoot, file)); hash.update(await fs.readFile(file)); }
            }
        };
        await hashFiles(imageRoot);
        hash.update(JSON.stringify([state.settings.selectedPhpVersion,
            [...new Set([...state.settings.php.extensions, ...state.settings.php.disabledExtensions])].sort(), state.settings.php.cwebpEnabled]));
        this.imageName = `vhostra-runtime:build-${hash.digest("hex").slice(0, 24)}`;
        await fs.writeFile(
            this.composeFile,
            singleRuntimeComposeYaml(
                state,
                this.layout,
                this.scope,
                !this.httpsWarning,
                this.imageName,
            ),
            { mode: 0o600 },
        );
    }
    private async ensureEnvironment() {
        let contents = "";
        try {
            contents = await fs.readFile(this.environmentFile, "utf8");
        } catch {
            /* generated on first use */
        }
        const missing = (name: string) =>
            !new RegExp(`^${name}=`, "m").test(contents);
        if (missing("MARIADB_ROOT_PASSWORD"))
            contents += `MARIADB_ROOT_PASSWORD=${randomBytes(24).toString("base64url")}\n`;
        if (missing("VHOSTRA_PMA_BLOWFISH_SECRET"))
            contents += `VHOSTRA_PMA_BLOWFISH_SECRET=${randomBytes(32).toString("base64url")}\n`;
        if (missing("VHOSTRA_PMA_PASSWORD"))
            contents += `VHOSTRA_PMA_PASSWORD=${randomBytes(32).toString("base64url")}\n`;
        for (const line of contents.split(/\r?\n/)) {
            const match = line.match(/^[^#=]*(?:PASSWORD|SECRET|TOKEN|KEY)[^=]*=(.*)$/i);
            if (match) this.secrets.add(match[1]);
        }
        await fs.writeFile(this.environmentFile, contents, { mode: 0o600 });
    }
    private async provisionPhpMyAdmin() {
        const contents = await fs.readFile(this.environmentFile, "utf8");
        const password = contents
            .match(/^VHOSTRA_PMA_PASSWORD=(.+)$/m)?.[1]
            ?.trim();
        if (!password)
            throw new Error(
                "Vhostra could not prepare secure phpMyAdmin credentials.",
            );
        const secret = sqlLiteral(password);
        const statement = `CREATE USER IF NOT EXISTS 'vhostra_pma'@'localhost' IDENTIFIED BY ${secret}; CREATE USER IF NOT EXISTS 'vhostra_pma'@'127.0.0.1' IDENTIFIED BY ${secret}; ALTER USER 'vhostra_pma'@'localhost' IDENTIFIED BY ${secret}; ALTER USER 'vhostra_pma'@'127.0.0.1' IDENTIFIED BY ${secret}; GRANT ALL PRIVILEGES ON *.* TO 'vhostra_pma'@'localhost' WITH GRANT OPTION; GRANT ALL PRIVILEGES ON *.* TO 'vhostra_pma'@'127.0.0.1' WITH GRANT OPTION; FLUSH PRIVILEGES;`;
        let lastError: unknown;
        for (let attempt = 0; attempt < 20; attempt += 1) {
            try {
                await this.compose([
                    "exec",
                    "-T",
                    "runtime",
                    "mariadb",
                    "-uroot",
                    "-e",
                    statement,
                ]);
                return;
            } catch (error) {
                lastError = error;
                await wait(1_000);
            }
        }
        throw lastError instanceof Error
            ? lastError
            : new Error("MariaDB did not become ready for phpMyAdmin.");
    }
    private async runDatabaseOperation<T>(
        message: string,
        action: () => Promise<T>,
    ) {
        return this.runExclusive("starting", message, async () => {
            await this.requireDocker();
            const result = await action();
            await this.refresh();
            return result;
        });
    }
    private async cleanGenerated(state: AppState) {
        await cleanObsoleteGenerated(this.layout.configuration.generated, state.settings.selectedWebServer);
        await cleanObsoleteRuntime(this.layout, state.settings.selectedWebServer, state.virtualHosts.map(host => host.id));
    }
    private async writeServerConfiguration(
        server: WebServer,
        phpVersion: PhpVersion,
        mounts: Array<{
            host: AppState["virtualHosts"][number];
            container: string;
        }>,
    ) {
        const generated = this.layout.configuration.generated;
        await fs.mkdir(generated, { recursive: true });
        {
            // Always generate the PHP backend's host routing, regardless of frontend.
            const managedMounts = mounts.filter(
                ({ host }) => host.builtIn !== "localhost",
            );
            await fs.mkdir(
                path.join(this.layout.runtime.openLiteSpeed, "sites"),
                { recursive: true },
            );
            await Promise.all([
                fs.writeFile(
                    path.join(
                        this.layout.runtime.openLiteSpeed,
                        "vhostra-maps.conf",
                    ),
                    generatedMarker + openLiteSpeedConfig(managedMounts),
                    { mode: 0o600 },
                ),
                fs.writeFile(
                    path.join(
                        this.layout.runtime.openLiteSpeed,
                        "vhostra-vhosts.conf",
                    ),
                    generatedMarker + openLiteSpeedVirtualHosts(managedMounts),
                    { mode: 0o600 },
                ),
                ...managedMounts.map(({ host, container }) =>
                    fs.writeFile(
                        path.join(
                            this.layout.runtime.openLiteSpeed,
                            "sites",
                            `${host.id}.conf`,
                        ),
                        generatedMarker + openLiteSpeedSiteConfig(host, container),
                        { mode: 0o600 },
                    ),
                ),
            ]);
        }
        if (server === "apache") {
            let config = apacheConfig(mounts);
            if (!this.httpsWarning) config += config.slice(config.indexOf("<VirtualHost")).replaceAll("<VirtualHost *:8088>",
                "<VirtualHost *:8443>\n  SSLEngine on\n  SSLCertificateFile /etc/vhostra/certificates/public/localhost.pem\n  SSLCertificateKeyFile /etc/vhostra/certificates/private/localhost.key\n  RequestHeader set X-Forwarded-Proto https");
            await Promise.all([
                fs.writeFile(
                    path.join(this.layout.runtime.apache, "vhostra.conf"),
                    generatedMarker + config,
                    { mode: 0o600 },
                ),
                fs.writeFile(
                    path.join(generated, "apache-vhosts.conf"),
                    generatedMarker + config,
                    { mode: 0o600 },
                ),
            ]);
        } else if (server === "nginx") {
            const config = nginxConfig(mounts, !this.httpsWarning);
            await Promise.all([
                fs.writeFile(
                    path.join(this.layout.runtime.nginx, "default.conf"),
                    generatedMarker + config,
                    { mode: 0o600 },
                ),
                fs.writeFile(
                    path.join(generated, "nginx-vhosts.conf"),
                    generatedMarker + config,
                    { mode: 0o600 },
                ),
            ]);
        } else {
            // The stock Example vhost remains the protected localhost vhost. Only
            // user-created portable definitions are injected as additional OLS vhosts.
            const managedMounts = mounts.filter(
                ({ host }) => host.builtIn !== "localhost",
            );
            const main = openLiteSpeedConfig(managedMounts);
            const virtualHosts = openLiteSpeedVirtualHosts(managedMounts);
            await fs.mkdir(
                path.join(this.layout.runtime.openLiteSpeed, "sites"),
                { recursive: true },
            );
            await Promise.all([
                fs.writeFile(
                    path.join(
                        this.layout.runtime.openLiteSpeed,
                        "vhostra-maps.conf",
                    ),
                    generatedMarker + main,
                    { mode: 0o600 },
                ),
                fs.writeFile(
                    path.join(
                        this.layout.runtime.openLiteSpeed,
                        "vhostra-vhosts.conf",
                    ),
                    generatedMarker + virtualHosts,
                    { mode: 0o600 },
                ),
                ...managedMounts.map(({ host, container }) =>
                    fs.writeFile(
                        path.join(
                            this.layout.runtime.openLiteSpeed,
                            "sites",
                            `${host.id}.conf`,
                        ),
                        generatedMarker + openLiteSpeedSiteConfig(host, container),
                        { mode: 0o600 },
                    ),
                ),
                fs.writeFile(
                    path.join(generated, "openlitespeed-vhosts.conf"),
                    generatedMarker + `${main}\n${virtualHosts}\n${managedMounts.map(({ host, container }) => `# ${host.hostname} (${host.id})\n${openLiteSpeedSiteConfig(host, container)}`).join("\n")}`,
                    { mode: 0o600 },
                ),
            ]);
        }
        // Keeps the PHP policy explicit in generated config metadata without exposing it over HTTP.
        await fs.writeFile(
            path.join(generated, "runtime-selection.json"),
            JSON.stringify(
                { owner: "vhostra", schemaVersion: 1, server, phpVersion, generatedAt: new Date().toISOString() },
                null,
                2,
            ),
            { mode: 0o600 },
        );
    }
    private async ensurePortsAvailable(
        ports: number[],
        allowProjectPorts = false,
    ) {
        const conflicts = await this.portConflicts(ports, allowProjectPorts);
        if (conflicts.length)
            throw new Error(
                `Vhostra cannot bind required host ports:\n${conflicts.join("\n")}\nStop or reconfigure the owning application yourself; Vhostra will not stop unrelated processes or containers.`,
            );
    }
    private async checkOptionalHttpsPort(allowProjectPorts = false) {
        const state = await this.getState();
        const conflicts = await this.portConflicts(
            [state.settings.ports.https],
            allowProjectPorts,
        );
        this.httpsWarning = conflicts.length
            ? `${conflicts.join("; ")}. Vhostra will continue with HTTP on port ${state.settings.ports.http} and will not alter the owner.`
            : "";
    }
    private async portConflicts(ports: number[], allowProjectPorts: boolean) {
        const conflicts: string[] = [];
        for (const port of ports) {
            const occupied = await isPortOccupied(port);
            if (!occupied) { this.appendProgress(`✓ localhost:${port} available`); continue; }
            const ownedByVhostra =
                allowProjectPorts && (await this.vhostraOwnsPort(port));
            if (!ownedByVhostra) conflicts.push(await describePort(port));
            else this.appendProgress(`✓ localhost:${port} belongs to the current managed runtime`);
        }
        return conflicts;
    }
    private async vhostraOwnsPort(port: number) {
        try {
            const ids = (await this.docker(["ps", "--filter", `label=${managedLabel}`,
                "--filter", `label=com.docker.compose.project=${this.scope}`, "--quiet"]))
                .trim().split(/\s+/).filter(Boolean);
            if (!ids.length) return false;
            const containers = JSON.parse(await this.docker(["inspect", ...ids]));
            return containers.some((container: { Config?: { Labels?: Record<string, string> }; NetworkSettings?: { Ports?: Record<string, Array<{ HostIp: string; HostPort: string }> | null> } }) => {
                const labels = container.Config?.Labels;
                return labels?.["com.vhostra.managed"] === "true"
                    && labels["com.docker.compose.project"] === this.scope
                    && labels["com.docker.compose.service"] === "runtime"
                    && Boolean(labels["com.docker.compose.project.working_dir"])
                    && (process.platform === "win32"
                        ? path.resolve(labels["com.docker.compose.project.working_dir"]).toLowerCase() === path.resolve(this.runtimeRoot).toLowerCase()
                        : path.resolve(labels["com.docker.compose.project.working_dir"]) === path.resolve(this.runtimeRoot))
                    && Object.values(container.NetworkSettings?.Ports ?? {}).some(bindings =>
                        bindings?.some(binding => Number(binding.HostPort) === port
                            && ["127.0.0.1", "0.0.0.0", "::", "::1", ""].includes(binding.HostIp)));
            });
        } catch { return false; }
    }
    private async healthCheck(server: WebServer, verifiedState?: AppState) {
        const state = verifiedState ?? (await this.getState());
        const ready = async (port: number, requestPath = "/") => {
            for (let attempt = 0; attempt < 20; attempt += 1) {
                const response = await requestLocalHttp(port, requestPath);
                if (/^HTTP\/\d(?:\.\d)? 200(?:\s|$)/.test(response)) return response;
                await wait(1_000);
            }
            return "";
        };
        const ports = state.settings.ports;
        this.appendProgress(`Checking ${server} HTTP health…`);
        if (!(await ready(ports.http)))
            throw new Error(
                `The ${server} runtime did not pass its localhost health check.`,
            );
        this.appendProgress(`✓ ${server} HTTP healthy`);
        this.appendProgress("Checking selected PHP runtime…");
        const php = await ready(ports.http, "/vhostra-health.php");
        if (!php.includes(`vhostra-lsphp:${state.settings.selectedPhpVersion}`))
            throw new Error(
                `The ${server} frontend did not invoke selected LSPHP ${state.settings.selectedPhpVersion}. Health response: ${php.slice(0, 300)}`,
            );
        await this.compose([
            "exec",
            "-T",
            "runtime",
            "mariadb",
            "-uroot",
            "-e",
            "SELECT 1",
        ]);
        this.appendProgress("✓ Selected PHP and MariaDB healthy");
        this.appendProgress("Checking PHP extensions and optional services…");
        const extensionHealth = await ready(
            ports.http,
            "/vhostra-extensions.php",
        );
        const expectExtension = (extension: string, enabled: boolean) => {
            if (enabled && !extensionHealth.includes(`${extension}:1`))
                throw new Error(
                    `The required PHP extension “${extension}” is not enabled in the selected LSPHP runtime.`,
                );
        };
        expectExtension("mysqli", true);
        expectExtension("pdo_mysql", true);
        expectExtension("opcache", state.settings.php.opcacheEnabled);
        if (!state.settings.php.opcacheEnabled && extensionHealth.includes("opcache:1")) throw new Error("OPcache remains enabled despite the saved disabled preference.");
        expectExtension(
            "redis",
            state.settings.optionalServices.redis ||
                state.settings.php.extensions.includes("redis"),
        );
        expectExtension(
            "memcached",
            state.settings.optionalServices.memcached ||
                state.settings.php.extensions.includes("memcached"),
        );
        const modules = new Set(
            parseHttpJson<string[]>(
                await ready(ports.http, "/vhostra-extension-state.php"),
            )?.map(normalizeExtensionId) ?? [],
        );
        for (const extension of state.settings.php.extensions)
            if (!modules.has(normalizeExtensionId(extension)))
                throw new Error(
                    `The selected PHP extension “${extension}” is not enabled in the replacement LSPHP runtime.`,
                );
        for (const extension of state.settings.php.disabledExtensions)
            if ([...modules].map(normalizeExtensionId).includes(normalizeExtensionId(extension))) throw new Error(`The disabled PHP extension “${extension}” is still loaded in the replacement runtime.`);
        if (state.settings.optionalServices.redis)
            await this.compose(["exec", "-T", "runtime", "redis-cli", "PING"]);
        if (state.settings.optionalServices.memcached)
            await this.compose([
                "exec",
                "-T",
                "runtime",
                "/bin/sh",
                "-lc",
                "printf 'version\\r\\n' | nc -w 3 127.0.0.1 11211 | grep -q '^VERSION'",
            ]);
        this.appendProgress("✓ Required extensions and optional services healthy");
        this.appendProgress("Checking phpMyAdmin HTTP health…");
        if (!(await ready(ports.phpMyAdmin, "/phpmyadmin/index.php")))
            throw new Error(
                "phpMyAdmin did not pass its shared-runtime health check.",
            );
        this.appendProgress("✓ phpMyAdmin healthy");
        if (state.settings.php.cwebpEnabled) {
            const output = await this.compose([
                "exec",
                "-T",
                "runtime",
                "/bin/sh",
                "-lc",
                "command -v cwebp >/dev/null && cwebp -version",
            ]);
            if (!output.trim())
                throw new Error(
                    "The requested cwebp binary is unavailable in the Vhostra runtime.",
                );
        }
    }
    private async availablePhpPackages() {
        const state = await this.getState();
        const php = state.settings.selectedPhpVersion.replace(".", "");
        // Discover directly from the selected LiteSpeed repository. Repository
        // descriptions identify development/runtime/meta artifacts generically;
        // all remaining versioned packages are module candidates and are still
        // verified against the loaded PHP runtime after every mutation.
        const output = await this.compose([
            "exec",
            "-T",
            "runtime",
            "/bin/sh",
            "-lc",
            "cat /usr/local/share/vhostra-php-catalog",
        ]);
        return output
            .split("\n")
            .map((value) => value.trim())
            .filter((value) => /^[a-z0-9][a-z0-9-]*$/.test(value));
    }
    private async installedPhpPackages() {
        const state = await this.getState();
        const php = state.settings.selectedPhpVersion.replace(".", "");
        const output = await this.compose(
            [
                "exec",
                "-T",
                "runtime",
                "/bin/sh",
                "-lc",
                `dpkg-query -W -f='${"${db:Status-Status}"} ${"${binary:Package}"}\\n' 'lsphp${php}-*' 2>/dev/null | awk '$1 == "installed" { print $2 }' | sed 's/^lsphp${php}-//' | sed 's/:.*$//' | sort -u`,
            ],
            true,
        );
        return output
            .split("\n")
            .map((value) => value.trim())
            .filter((value) => /^[a-z0-9][a-z0-9-]*$/.test(value));
    }
    private async configureRuntimePhpExtension(
        php: string,
        extension: string,
        enabled: boolean,
    ) {
        // LiteSpeed scans mods-available directly. Toggle the exact package INI
        // atomically so a disabled extension cannot stay loaded through that scan.
        const command = `ini=/usr/local/lsws/lsphp${php}/etc/php/${php.slice(0, 1)}.${php.slice(1)}/litespeed/php.ini; sed -i '/; Vhostra extension ${extension}$/d' "$ini"; dir=/usr/local/lsws/lsphp${php}/etc/php/${php.slice(0, 1)}.${php.slice(1)}/mods-available; source=$(find "$dir" -maxdepth 1 -type f -name '*${extension}*.ini' -print -quit); disabled=$(find "$dir" -maxdepth 1 -type f -name '*${extension}*.ini.disabled' -print -quit); if [ ${enabled ? "true" : "false"} = true ]; then if [ -n "$disabled" ]; then mv "$disabled" "${"${disabled%.disabled}"}"; elif [ -z "$source" ]; then exit 65; fi; else if [ -n "$source" ]; then mv "$source" "$source.disabled"; elif [ -z "$disabled" ]; then exit 65; fi; fi`;
        await this.compose([
            "exec",
            "-T",
            "runtime",
            "/bin/sh",
            "-lc",
            command,
        ]);
    }
    private async reconcileHtaccessWatchers(running: boolean) {
        const state = await this.getState();
        if (this.disposed) return;
        if (!running || state.settings.selectedWebServer !== "openlitespeed") {
            this.clearHtaccessWatchers();
            return;
        }
        const desired = new Map(
            state.virtualHosts
                .filter((host) => host.rewriteEnabled !== false)
                .map((host) => [host.id, host.documentRoot]),
        );
        for (const [id, watcher] of this.htaccessWatchers)
            if (!desired.has(id) || desired.get(id) !== this.htaccessRoots.get(id)) {
                watcher.close();
                this.htaccessWatchers.delete(id);
                this.htaccessRoots.delete(id);
            }
        for (const [id, root] of desired) {
            if (this.htaccessWatchers.has(id)) continue;
            try {
                const watcher = watch(
                    root,
                    { persistent: false },
                    (_event, filename) => {
                        if (String(filename) !== ".htaccess" || this.disposed) return;
                        const generation = ++this.htaccessGeneration;
                        if (this.htaccessDebounce)
                            clearTimeout(this.htaccessDebounce);
                        this.htaccessDebounce = setTimeout(() => {
                            this.htaccessDebounce = null;
                            void (async () => {
                                await this.operation;
                                if (this.disposed || generation !== this.htaccessGeneration || !this.htaccessWatchers.size) return;
                                await this.reloadWebServer();
                            })().catch((error) =>
                                this.set({
                                    state: "error",
                                    message: `OpenLiteSpeed could not reload after a .htaccess change: ${error instanceof Error ? error.message : String(error)}`,
                                    services: ["runtime"],
                                }),
                            );
                        }, 600);
                    },
                );
                watcher.on("error", (error) =>
                    this.set({
                        state: "error",
                        message: `Vhostra could not watch ${root}/.htaccess: ${error.message}`,
                        services: ["runtime"],
                    }),
                );
                this.htaccessWatchers.set(id, watcher);
                this.htaccessRoots.set(id, root);
            } catch (error) {
                this.set({
                    state: "error",
                    message: `Vhostra could not watch ${root}/.htaccess: ${error instanceof Error ? error.message : String(error)}`,
                    services: ["runtime"],
                });
            }
        }
    }
    private clearHtaccessWatchers() {
        for (const watcher of this.htaccessWatchers.values()) watcher.close();
        this.htaccessWatchers.clear();
        this.htaccessRoots.clear();
        this.htaccessGeneration++;
        if (this.htaccessDebounce) clearTimeout(this.htaccessDebounce);
        this.htaccessDebounce = null;
    }
    private async docker(args: string[]) {
        this.counters.dockerCalls++;
        return execute("docker", args, false, undefined, 30000);
    }
    private async compose(args: string[], allowFailure = false) {
        this.counters.composeCalls++;
        const action = args[0];
        const safeExec = action === "exec" && (args.includes("supervisorctl") || args.includes("redis-cli") || args.some(arg => /^DEBIAN_FRONTEND=noninteractive apt-get (?:update|purge)/.test(arg)));
        const streamable = safeExec || ["up", "build", "pull", "stop", "down", "restart", "start"].includes(action);
        if (this.progress && streamable) this.appendProgress(`Docker Compose: ${action} (${this.scope})`);
        const result = await execute("docker", this.composeArguments(args), allowFailure,
            streamable ? text => this.appendProgress(text) : undefined, ["up", "build", "pull"].includes(action) || safeExec && args.some(arg => arg.startsWith("DEBIAN_FRONTEND=noninteractive apt-get")) ? 15 * 60_000 : 120_000);
        if (this.progress && streamable) this.appendProgress(`✓ Docker Compose ${action} completed`);
        return result;
    }
    private composeArguments(args: string[]) {
        return [
            "compose",
            "--project-name",
            this.scope,
            "--project-directory",
            this.runtimeRoot,
            "--env-file",
            this.environmentFile,
            "--file",
            this.composeFile,
            ...args,
        ];
    }
}

const execute = (command: string, args: string[], allowFailure = false, output?: (text: string) => void, timeoutMs = 30000) =>
    new Promise<string>((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: ["ignore", "pipe", "pipe"],
        });
        let timedOut = false;
        const timeout = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, timeoutMs);
        const force = setTimeout(() => { if (timedOut) child.kill("SIGKILL"); }, timeoutMs + 3000);
        timeout.unref(); force.unref();
        let stdout = "";
        let stderr = "";
        let pending = "";
        let discardingLine = false;
        const stream = (data: unknown) => {
            let incoming = String(data);
            if (discardingLine) {
                const boundary = incoming.search(/[\r\n]/);
                if (boundary < 0) return;
                incoming = incoming.slice(boundary + 1);
                discardingLine = false;
            }
            pending += incoming;
            const lines = pending.split(/\r\n|\r|\n/);
            pending = lines.pop() ?? "";
            if (lines.length) output?.(lines.join("\n"));
            if (pending.length > 65536) { pending = ""; discardingLine = true; output?.("[Oversized output line omitted]"); }
        };
        child.stdout.on("data", (data) => {
            stdout = (stdout + String(data)).slice(-1048576);
            stream(data);
        });
        child.stderr.on("data", (data) => {
            stderr = (stderr + String(data)).slice(-1048576);
            stream(data);
        });
        child.once("error", error => { clearTimeout(timeout); clearTimeout(force); reject(error); });
        child.once("close", (code) => {
            clearTimeout(timeout); clearTimeout(force);
            if (timedOut) { reject(new Error(`${command} operation timed out after ${Math.round(timeoutMs / 1000)} seconds.`)); return; }
            if (pending) output?.(pending);
            code === 0 || allowFailure
                ? resolve(stdout)
                : reject(
                      new Error(
                          stderr.trim() ||
                              `${command} operation exited with ${code}`,
                      ),
                  );
        });
    });
const executeWithInput = async (
    command: string,
    args: string[],
    input: string,
) => {
    const child = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (data) => {
        stderr = (stderr + String(data)).slice(-65536);
    });
    const source = createReadStream(input);
    try { await Promise.all([
        pipeline(source, child.stdin),
        new Promise<void>((resolve, reject) => {
            child.once("error", reject);
            child.once("close", (code) =>
                code === 0
                    ? resolve()
                    : reject(
                          new Error(
                              stderr.trim() ||
                                  `${command} import failed with ${code}`,
                          ),
                      ),
            );
        }),
    ]); } catch (error) { child.kill("SIGTERM"); throw error; }
};
const executeWithOutput = async (
    command: string,
    args: string[],
    output: string,
) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (data) => {
        stderr = (stderr + String(data)).slice(-65536);
    });
    const destination = createWriteStream(output, { mode: 0o600 });
    try { await Promise.all([
        pipeline(child.stdout, destination),
        new Promise<void>((resolve, reject) => {
            child.once("error", reject);
            child.once("close", (code) =>
                code === 0
                    ? resolve()
                    : reject(
                          new Error(
                              stderr.trim() ||
                                  `${command} export failed with ${code}`,
                          ),
                      ),
            );
        }),
    ]); } catch (error) { child.kill("SIGTERM"); throw error; }
};
const parseJsonLines = (value: string) =>
    value.split("\n").flatMap((line) => {
        try {
            return [JSON.parse(line)];
        } catch {
            return [];
        }
    });
const parseHttpJson = <T>(value: string): T | null => {
    const body = value.slice(value.indexOf("\r\n\r\n") + 4).trim();
    try {
        return JSON.parse(body) as T;
    } catch {
        return null;
    }
};
const normalizeExtensionId = (value: string) =>
    value
        .trim()
        .toLowerCase()
        .replace(/^zend[ _-]?/, "")
        .replace(/[ _]/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .replace(/^ioncube(?:-php)?-loader$/, "ioncube");
const extensionLabel = (id: string) =>
    id === "opcache"
        ? "Zend OPcache"
        : id.replace(
              /(^|[-_])(.)/g,
              (_match, prefix: string, letter: string) =>
                  `${prefix ? " " : ""}${letter.toUpperCase()}`,
          );
const wait = (milliseconds: number) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds));
const validatePort = (port: number) => {
    if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error("A port must be an integer from 1 to 65535.");
};
const sqlIdentifier = (value: string, label: string) => {
    const normalized = value.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(normalized))
        throw new Error(
            `Invalid ${label}. Use letters, digits, and underscores only.`,
        );
    return normalized;
};
const sqlLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;
/**
 * macOS denies an unprivileged Node process a test bind below 1024 with EACCES.
 * That is not evidence of a listener: verify the actual TCP endpoint before
 * declaring a conflict. Docker Desktop can publish privileged ports separately.
 */
const isPortOccupied = (port: number) =>
    new Promise<boolean>((resolve) => {
        const server = net.createServer();
        server.once("error", (error) => {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === "EADDRINUSE") return resolve(true);
            if (code === "EACCES") return resolve(connectsToPort(port));
            resolve(false);
        });
        server.once("listening", () => server.close(() => resolve(false)));
        server.listen(port, "127.0.0.1");
    });
const connectsToPort = (port: number) =>
    new Promise<boolean>((resolve) => {
        const socket = net.connect({ port, host: "127.0.0.1" });
        socket.setTimeout(750);
        socket.once("connect", () => {
            socket.destroy();
            resolve(true);
        });
        socket.once("error", () => resolve(false));
        socket.once("timeout", () => {
            socket.destroy();
            resolve(false);
        });
    });
const requestLocalHttp = (port: number, requestPath = "/") =>
    new Promise<string>((resolve) => {
        const socket = net.connect({ port, host: "127.0.0.1" });
        let output = "";
        socket.setTimeout(8_000);
        socket.on("connect", () =>
            socket.write(
                `GET ${requestPath} HTTP/1.0\r\nHost: localhost\r\n\r\n`,
            ),
        );
        socket.on("data", (data) => {
            output += String(data).slice(0, Math.max(0, 1024 * 1024 - output.length));
            if (output.length >= 1024 * 1024) { socket.destroy(); resolve(output); }
        });
        socket.on("error", () => resolve(""));
        socket.on("timeout", () => {
            socket.destroy();
            resolve("");
        });
        socket.on("close", () => resolve(output));
    });
async function describePort(port: number) {
    const owners: string[] = [];
    try {
        const output = await execute(
            "lsof",
            ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"],
            true,
        );
        const lines = output.trim().split("\n");
        if (lines.length > 1)
            owners.push(`process ${lines.slice(1).join("; ")}`);
    } catch {
        /* Windows/Linux fall back below. */
    }
    try {
        const output = await execute(
            "docker",
            ["ps", "--format", "{{.Names}} {{.Ports}}"],
            true,
        );
        const line = output
            .split("\n")
            .find((value) => value.includes(`:${port}->`));
        if (line) owners.push(`Docker container ${line}`);
    } catch {
        /* Docker may be unavailable. */
    }
    return `localhost:${port} is already in use${owners.length ? ` by ${owners.join(" and ")}` : " (owner could not be identified)"}`;
}
const dockerMessage = (error: unknown) =>
    `Docker is unavailable: ${error instanceof Error ? error.message : String(error)}`;

function apacheConfig(
    mounts: Array<{
        host: AppState["virtualHosts"][number];
        container: string;
    }>,
) {
    return `ServerTokens Prod\nServerSignature Off\nTraceEnable Off\nProxyPreserveHost On\nRequestHeader set X-Forwarded-Proto http\nRequestHeader set X-Vhostra-Request-Line "expr=%{THE_REQUEST}"\nDirectoryIndex index.php index.html\n${mounts.map(({ host, container }) => `<VirtualHost *:8088>\n  ServerName ${host.hostname}\n  ${host.aliases.map((alias) => `ServerAlias ${alias}`).join("\n  ")}\n  DocumentRoot ${container}\n  DirectoryIndex ${host.builtIn === "localhost" ? "index.html" : (host.indexFiles ?? ["index.php", "index.html"]).join(" ")}\n  ProxyPassMatch "^/(.*\\.php(?:/.*)?)$" "http://127.0.0.1:8089/$1"\n  <Directory ${container}>\n    Options FollowSymLinks\n    AllowOverride ${host.rewriteEnabled === false ? "None" : "FileInfo"}\n    Require all granted\n  </Directory>\n  ${host.rewriteEnabled === false ? "RewriteEngine Off" : "RewriteEngine On"}\n  ErrorLog /proc/self/fd/2\n  CustomLog /proc/self/fd/1 combined\n</VirtualHost>`).join("\n\n")}\n`;
}
function nginxConfig(
    mounts: Array<{
        host: AppState["virtualHosts"][number];
        container: string;
    }>,
    httpsEnabled: boolean,
) {
    return `${mounts.map(({ host, container }) => `server {\n  server_tokens off;\n  listen 8088;\n  ${httpsEnabled ? "listen 8443 ssl;\n  ssl_certificate /etc/vhostra/certificates/public/localhost.pem;\n  ssl_certificate_key /etc/vhostra/certificates/private/localhost.key;\n  ssl_protocols TLSv1.2 TLSv1.3;" : ""}\n  server_name ${[host.hostname, ...host.aliases].join(" ")};\n  root ${container};\n  index ${(host.indexFiles ?? ["index.php", "index.html"]).join(" ")};\n  access_log /dev/stdout;\n  error_log /dev/stderr;\n  location ~ /\\. { deny all; }\n  # Vhostra managed WordPress-compatible front controller. Unsupported .htaccess directives remain reported in the neutral model.\n  location / { try_files $uri $uri/ ${host.rewriteEnabled === false ? "=404" : "/index.php?$query_string"}; }\n  location ~ \\.php(?:/|$) { proxy_set_header Host $http_host; proxy_set_header X-Forwarded-Proto $scheme; proxy_set_header X-Vhostra-Request-Line ""; proxy_set_header X-Vhostra-Request-Uri $request_uri; proxy_pass http://127.0.0.1:8089; }\n}\n`).join("\n")}`;
}
function openLiteSpeedConfig(
    mounts: Array<{
        host: AppState["virtualHosts"][number];
        container: string;
    }>,
) {
    return `${mounts.flatMap(({ host }) => [`map ${host.id} ${host.hostname}`, ...host.aliases.map((alias) => `map ${host.id} ${alias}`)]).join("\n")}\n`;
}
function openLiteSpeedVirtualHosts(
    mounts: Array<{
        host: AppState["virtualHosts"][number];
        container: string;
    }>,
) {
    return mounts
        .map(
            ({ host, container }) =>
                `virtualHost ${host.id}{\n    vhRoot                   ${container}/\n    allowSymbolLink          1\n    enableScript             1\n    configFile               /etc/vhostra/openlitespeed/sites/${host.id}.conf\n}\n`,
        )
        .join("\n");
}
function openLiteSpeedSiteConfig(
    host: AppState["virtualHosts"][number],
    container: string,
) {
    return `docRoot ${container}/\nindex {\n  indexFiles ${(host.indexFiles ?? ["index.php", "index.html"]).join(",")}\n}\nrewrite {\n  enable ${host.rewriteEnabled === false ? "0" : "1"}\n  autoLoadHtaccess ${host.rewriteEnabled === false ? "0" : "1"}\n}\ncontext / {\n  allowBrowse 1\n  location $DOC_ROOT/\n}\naccessControl {\n  deny\n  allow *\n}\n`;
}

function singleRuntimeComposeYaml(
    state: AppState,
    layout: StoreLayout,
    scope: string,
    httpsEnabled: boolean,
    imageName: string,
) {
    const php = state.settings.selectedPhpVersion.replace(".", "");
    return `name: ${scope}
services:
  runtime:
    build:
      context: ./image
      args:
        LSPHP_VERSION: ${q(php)}
        LSPHP_EXTENSIONS: ${q([...new Set([...state.settings.php.extensions, ...state.settings.php.disabledExtensions])].join(","))}
        VHOSTRA_CWEBP: ${q(state.settings.php.cwebpEnabled)}
      labels:
        com.vhostra.managed: "true"
        com.vhostra.purpose: "runtime-image"
    image: ${q(imageName)}
    labels:
      ${managedLabel.split("=").map(q).join(": ")}
    ports:
      - ${q(`127.0.0.1:${state.settings.ports.http}:8088`)}
      - ${q(`127.0.0.1:${state.settings.ports.phpMyAdmin}:8088`)}
      - ${q(`127.0.0.1:${state.settings.ports.mariadb}:3306`)}
      ${httpsEnabled ? `- ${q(`127.0.0.1:${state.settings.ports.https}:8443`)}` : ""}
    environment:
      VHOSTRA_LSPHP_VERSION: ${q(php)}
      VHOSTRA_WEB_SERVER: ${q(state.settings.selectedWebServer)}
      VHOSTRA_HTTPS: ${q(httpsEnabled)}
      VHOSTRA_TLS_NAMES: ${q(
          [
              "DNS:localhost",
              "IP:127.0.0.1",
              ...state.virtualHosts
                  .flatMap((host) => [host.hostname, ...host.aliases])
                  .filter(
                      (name) =>
                          /^[a-z0-9.-]+$/i.test(name) && name !== "localhost",
                  )
                  .map((name) => `DNS:${name}`),
          ].join(","),
      )}
      VHOSTRA_REDIS: ${q(state.settings.optionalServices.redis)}
      VHOSTRA_MEMCACHED: ${q(state.settings.optionalServices.memcached)}
      VHOSTRA_PHP_EXTENSIONS: ${q(state.settings.php.extensions.join(","))}
      VHOSTRA_PHP_DISABLED_EXTENSIONS: ${q(state.settings.php.disabledExtensions.join(","))}
      VHOSTRA_OPCACHE: ${q(state.settings.php.opcacheEnabled)}
      VHOSTRA_PMA_BLOWFISH_SECRET: \${VHOSTRA_PMA_BLOWFISH_SECRET}
      VHOSTRA_PMA_PASSWORD: \${VHOSTRA_PMA_PASSWORD}
    volumes:
      - ${q(`${path.join(layout.sites, "localhost", "public")}:/var/www/html`)}
      - ${q(`${layout.runtime.openLiteSpeed}:/etc/vhostra/openlitespeed:ro`)}
      - ${q(`${layout.runtime.php}:/etc/vhostra/php:ro`)}
      - ${q(`${layout.runtime.mariaDb}/vhostra.cnf:/etc/mysql/mariadb.conf.d/99-vhostra.cnf:ro`)}
      - ${q(`${layout.runtime.redis}/redis.conf:/etc/redis/vhostra.conf:ro`)}
      - ${q(`${layout.runtime.apache}:/etc/vhostra/apache:ro`)}
      - ${q(`${layout.runtime.nginx}:/etc/vhostra/nginx:ro`)}
      - ${q(`${layout.certificates.directory}:/etc/vhostra/certificates`)}
      ${state.sites
          .filter((site) => !site.builtIn)
          .map(
              (site) =>
                  `- ${q(`${site.documentRoot}:/var/www/vhostra/${site.vhostId}:ro`)}`,
          )
          .join("\n      ")}
      - ${q(`${layout.persistentData.mariaDb}:/var/lib/mysql`)}
      - ${q(`${layout.logs}:/var/log/vhostra`)}
    logging:
      driver: json-file
      options: { max-size: "5m", max-file: "3" }
    networks: [vhostra]
networks:
  vhostra:
    name: ${scope}-network
    labels:
      ${managedLabel.split("=").map(q).join(": ")}
`;
}
