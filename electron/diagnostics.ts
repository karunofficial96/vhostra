import { app } from 'electron'
import type { DockerRuntimeController } from './runtime.js'

/** Explicit, local development diagnostics. No renderer IPC or production timer. */
export function startResourceDiagnostics(controller: () => DockerRuntimeController, visible: () => boolean) {
    if (app.isPackaged || process.env.NODE_ENV !== 'development' || process.env.VHOSTRA_RESOURCE_DEBUG !== '1') return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sample = async () => {
        const runtime = controller();
        const metrics = app.getAppMetrics().map(({ pid, type, cpu, memory }) => ({
            pid, type, cpuPercent: Number(cpu.percentCPUUsage.toFixed(2)), rssKiB: memory.workingSetSize,
        }));
        const container = await runtime.resourceUsage().catch(() => null);
        if (stopped) return;
        console.info('[Vhostra resources]', JSON.stringify({ at: new Date().toISOString(), visible: visible(),
            processCount: metrics.length, processes: metrics, main: process.memoryUsage(),
            runtime: runtime.diagnostics(), container }));
        timer = setTimeout(() => { void sample(); }, 30000);
        timer.unref();
    };
    // First app.getAppMetrics call establishes CPU measurement baselines.
    app.getAppMetrics();
    timer = setTimeout(() => { void sample(); }, 10000);
    timer.unref();
    const stop = () => { stopped = true; clearTimeout(timer); };
    app.once('before-quit', stop);
    return stop;
}
