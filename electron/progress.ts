/** Redact before output crosses IPC. Raw command arguments are never broadcast. */
export function redactProgress(value: string, secrets: Iterable<string> = []) {
    let text = value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    for (const secret of secrets) if (secret.length) text = text.split(secret).join('********');
    return text
        .replace(/-----BEGIN [^-]*(?:PRIVATE KEY|CERTIFICATE)-----[\s\S]*?(?:-----END [^-]+-----|$)/g, '[private material redacted]')
        .replace(/(authorization\s*[:=]\s*)(?:Basic|Bearer)?\s*[^\r\n]+/gi, '$1********')
        .replace(/((?:[\w-]*(?:password|passwd|secret|token|credential|api[_-]?key)[\w-]*)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1********')
        .replace(/(--password\s+|\s-p)([^\s]+)/gi, '$1********')
        .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1********@');
}
