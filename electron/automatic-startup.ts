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

export function startAutomaticServices(controller: Controller, logs: string, options: {
    attempts?: number; delay?: (ms: number) => Promise<void>;
    report?: (message: string) => Promise<unknown>;
} = {}): Promise<void> {
    if (pending) return pending;
    const report = options.report ?? (message => recordApplicationLog(logs, message));
    const delay = options.delay ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
    const task = async () => {
        try {
            const attempts = options.attempts ?? 10;
            for (let attempt = 0; attempt < attempts; attempt++) {
                const current = controller.current();
                if (current.progress || ['starting', 'stopping'].includes(current.state)) return;
                const docker = await controller.checkPrerequisite();
                if (docker.state === 'ready') {
                    const refreshed = await controller.refresh();
                    if (refreshed.progress || ['starting', 'stopping'].includes(refreshed.state)) return;
                    if (['stopped', 'not-created'].includes(refreshed.state)) {
                        await controller.start();
                        return;
                    }
                    if (refreshed.state === 'running') {
                        const statuses = await controller.listManagedServices();
                        if (statuses.some(service => service.enabled && ['starting', 'stopping', 'restarting'].includes(service.state))) return;
                        for (const id of ['mariadb', 'web', 'redis', 'memcached'] as const) {
                            const service = statuses.find(item => item.id === id);
                            if (service?.enabled && ['stopped', 'failed', 'unhealthy'].includes(service.state)) {
                                try { await controller.controlManagedService(id, 'start'); }
                                catch { await report(`Automatic service startup could not start ${id}. Open Vhostra to inspect Runtime Status and the application log.`); }
                            }
                        }
                        return;
                    }
                    await report(`Automatic service startup could not verify the runtime: ${refreshed.message}`);
                    return;
                }
                if (docker.state === 'missing' || docker.state === 'broken') {
                    await report(`Automatic service startup skipped: Docker is ${docker.state}. Open Vhostra to check Docker settings.`);
                    return;
                }
                if (attempt < attempts - 1) await delay(Math.min(3000 * (attempt + 1), 10000));
            }
            await report('Automatic service startup timed out waiting for Docker Engine. Open Vhostra and start services after Docker is ready.');
        } catch {
            await report('Automatic service startup failed. Open Vhostra to inspect Runtime Status and the application log.');
        }
    };
    pending = task().finally(() => { pending = null; });
    return pending;
}
