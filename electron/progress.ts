/** Redact before output crosses IPC. Raw command arguments are never broadcast. */
export function redactProgress(value: string, secrets: Iterable<string> = []) {
    let text = value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    for (const secret of secrets) if (secret.length) text = text.split(secret).join('********');
    return text
        .replace(/(IDENTIFIED\s+(?:BY|VIA)[^;\r\n]*|PASSWORD\s*\([^)]*\))/gi, '[database authentication clause redacted]')
        .replace(/-----BEGIN [^-]*(?:PRIVATE KEY|CERTIFICATE)-----[\s\S]*?(?:-----END [^-]+-----|$)/g, '[private material redacted]')
        .replace(/(authorization\s*[:=]\s*)(?:Basic|Bearer)?\s*[^\r\n]+/gi, '$1********')
        .replace(/((?:[\w-]*(?:password|passwd|pwd|secret|token|credential|authentication[_-]?string|auth[_-]?string|api[_-]?key|access[_-]?key|private[_-]?key)[\w-]*)\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi, '$1********')
        .replace(/(define\s*\(\s*['"](?:DB_PASSWORD|AUTH_KEY|SECURE_AUTH_KEY|LOGGED_IN_KEY|NONCE_KEY|AUTH_SALT|SECURE_AUTH_SALT|LOGGED_IN_SALT|NONCE_SALT)['"]\s*,\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gi, '$1"********"')
        .replace(/(--password\s+|\s-p)([^\s]+)/gi, '$1********')
        .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1********@');
}
