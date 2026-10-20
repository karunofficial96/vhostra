export function shouldConfirmQuit(confirmedShutdown: boolean, alreadyQuitting: boolean, runtimeAvailable: boolean): boolean {
    return !confirmedShutdown && !alreadyQuitting && runtimeAvailable;
}

export function installWindowSessionEndHandlers(
    window: { on(event: 'query-session-end' | 'session-end', listener: () => void): unknown },
    platform: NodeJS.Platform,
    confirmed: () => void,
): void {
    if (platform !== 'win32') return;
    window.on('query-session-end', confirmed);
    window.on('session-end', confirmed);
}
