import { recordApplicationLog } from './logs.js';
import type { DockerCheck } from './docker-prerequisite.js';

type Snapshot = { state: string; message: string; progress?: unknown };
type Controller = {
    current(): Snapshot;
    checkPrerequisite(): Promise<DockerCheck>;
    refresh(): Promise<Snapshot>;
    start(): Promise<unknown>;
    listManagedServices(): Promise<Array<{ id: 'web' | 'mariadb' | 'redis' | 'memcached'; enabled: boolean; state: string }>>;
    controlManagedService(id: 'web' | 'mariadb' | 'redis' | 'memcached', action: 'start'): Promise<unknown>;
};

let pending: Promise<void> | null = null;

/** Shared by the manual button and both automatic launch modes. */
export async function startConfiguredServices(controller: Controller): Promise<void> {
    const snapshot = await controller.refresh();
    if (snapshot.progress || ['starting', 'stopping'].includes(snapshot.state)) return;
    if (snapshot.state !== 'running') {
        await controller.start();
        return;
    }
    const statuses = await controller.listManagedServices();
    for (const id of ['mariadb', 'web', 'redis', 'memcached'] as const) {
        const service = statuses.find(item => item.id === id);
        if (service?.enabled && (['stopped', 'not-created', 'failed', 'unhealthy', 'unavailable'].includes(service.state)
            || id === 'mariadb' && service.state === 'starting'))
            await controller.controlManagedService(id, 'start');
    }
}

export function startAutomaticServices(controller: Controller, logs: string, options: {
    attempts?: number; delay?: (ms: number) => Promise<void>;
    report?: (message: string) => Promise<unknown>;
} = {}): Promise<void> {
    if (pending) return pending;
    const report = options.report ?? (message => recordApplicationLog(logs, message));
    const delay = options.delay ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
    const task = async () => {
        try {
            // Docker Desktop can quit and restart more than once during an OS
            // login. Its observed recovery can exceed the former 10-probe
            // window; retain a finite background wait of roughly three minutes.
            const attempts = options.attempts ?? 20;
            for (let attempt = 0; attempt < attempts; attempt++) {
                const docker = await controller.checkPrerequisite();
                if (docker.state === 'ready') {
                    await startConfiguredServices(controller);
                    return;
                }
                // Docker Desktop can briefly return a daemon error (including
                // "permission denied") while replacing its socket at login.
                if (docker.state === 'missing') {
                    await report(`Automatic service startup skipped: Docker is ${docker.state}. Open Vhostra to check Docker settings.`);
                    return;
                }
                if (attempt === 0 || attempt === attempts - 1)
                    await report(`Automatic service startup waiting for Docker Engine (${docker.state}${docker.detail ? `: ${docker.detail}` : ''}); attempt ${attempt + 1}/${attempts}.`);
                if (attempt < attempts - 1) await delay(Math.min(3000 * (attempt + 1), 10000));
            }
            await report('Automatic service startup timed out waiting for Docker Engine. Open Vhostra and start services after Docker is ready.');
        } catch (error) {
            await report(`Automatic service startup failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
    pending = task().finally(() => { pending = null; });
    return pending;
}
