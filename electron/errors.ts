import { redactProgress } from './progress.js'

export interface ErrorDiagnostic { title: string; explanation: string; details: Array<{ label: string; value: string }> }
/** Pure, bounded parsing of already available output; no commands or background scans. */
export function parseError(value: unknown): ErrorDiagnostic {
    const raw = value instanceof Error ? value.message : String(value ?? 'The action could not be completed.');
    const text = redactProgress(raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '').replace(/^Error: /, '')).slice(-12000);
    let title = 'Vhostra could not complete this action.'; let explanation = 'Review the details and try again.'; let cause: string | undefined; let service: string | undefined;
    if (/Database already exists/i.test(text)) { title = 'Database already exists.'; explanation = 'Choose a different database name.'; cause = 'Duplicate database name'; service = 'MariaDB'; }
    else if (/database user already exists/i.test(text)) { title = 'Database user already exists.'; explanation = text.match(/"[^"]+" already exists for host "[^"]+"\. Select this user from the Database User list instead\./)?.[0] ?? 'Select this user from the Database User list instead.'; cause = 'Duplicate database account'; service = 'MariaDB'; }
    else if (/Access denied|rejected the username|could not connect to the database|error (1045|1044|1142)|Account mismatch|connection matched/i.test(text)) { title = 'Vhostra could not connect to the database.'; explanation = 'The username, password, host, or database permissions may not match.'; cause = /connection matched|Account mismatch/i.test(text) ? 'A different database account matched the connection' : /1044|1142/i.test(text) ? 'Database access was rejected' : /1045|Access denied/i.test(text) ? 'Authentication was rejected' : undefined; service = 'MariaDB'; }
    else if (/ERROR \d+|MariaDB/i.test(text)) { title = 'MariaDB could not complete this action.'; explanation = 'Review the database details before trying again.'; service = 'MariaDB'; }
    else if (/nginx/i.test(text)) { title = /invalid.*directive|unknown directive|invalid number of arguments|syntax error|configuration.*(?:error|failed)/i.test(text) ? 'Nginx could not start because its configuration contains an error.' : 'Nginx could not complete this action.'; explanation = 'Review the service or configuration details.'; service = 'Nginx'; }
    else if (/apache|AH\d{5}|(?:^|\s)httpd(?:\s|:)/i.test(text)) { title = 'Apache could not complete this action.'; explanation = 'Review the service or configuration details.'; service = 'Apache'; }
    else if (/openlitespeed|lshttpd/i.test(text)) { title = 'OpenLiteSpeed could not complete this action.'; explanation = 'Review the service or configuration details.'; service = 'OpenLiteSpeed'; }
    else if (/PHP (?:Fatal|Parse)|Uncaught .*Error|PHP.*(?:failed|error|could not complete)/i.test(text)) { title = 'PHP could not complete this action.'; explanation = 'Review the PHP error details.'; service = 'PHP'; }
    else if (/Redis|Memcached/i.test(text)) { service = /Redis/i.test(text) ? 'Redis' : 'Memcached'; title = `${service} could not complete this action.`; explanation = 'Review the service connection or configuration details.'; }
    else if (/Docker|daemon socket|container.*(?:failed|unavailable)/i.test(text)) { title = 'Vhostra could not connect to its runtime.'; explanation = 'Check Docker and the runtime details.'; service = 'Docker'; }
    else if (/hosts (?:file|operation)|administrator|permission.*hosts/i.test(text)) { title = 'Vhostra could not update the Hosts file.'; explanation = 'Review file permissions and the reported details.'; service = 'Hosts'; }
    else if (/^Start the web runtime|^Choose an existing host document-root directory|^Enter |^Database passwords|^This database user no longer|^This database account is reserved|^Unsupported MariaDB/i.test(text)) { title = text.split(/\n/)[0]; explanation = ''; }
    if (/invalid number of arguments/i.test(text)) cause = 'Invalid directive arguments';
    else if (/syntax error/i.test(text)) cause = 'Invalid syntax';
    const details: ErrorDiagnostic['details'] = [];
    if (cause) details.push({ label: 'Cause', value: cause });
    if (service) details.push({ label: 'Service', value: service });
    // Only patterns that carry a real file/line pair are accepted.
    const location = text.match(/\bin\s+([^\r\n]+?)\s+on line\s+(\d+)/i) ?? text.match(/(?:Syntax error on line (\d+) of (\/[^:\r\n]+))/i);
    const nginx = text.match(/\bin\s+(\/[^\r\n]+?):(\d+)(?:\s|$)/i);
    if (location) { const apache = /^Syntax error/i.test(location[0]); details.push({label:'File',value:location[apache ? 2 : 1]}, {label:'Line',value:location[apache ? 1 : 2]}); }
    else if (nginx) details.push({label:'File',value:nginx[1]}, {label:'Line',value:nginx[2]});
    for (const label of ['Database user','Requested host','Database','Affected value']) { const match = text.match(new RegExp(`${label}: ([^;\\r\\n]+)`,'i')); if (match) details.push({label,value:match[1].replace(/\.$/,'')}); }
    details.push({ label: 'Technical message', value: text });
    return { title, explanation, details };
}
export function mapDiagnosticPaths(text: string, mappings: Array<[string,string]>) {
    return [...mappings].sort((a,b)=>b[0].length-a[0].length).reduce((message,[container,host])=> {
        const escaped = container.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return message.replace(new RegExp(escaped + '(?=/|[\\s:\"\'()\\[\\],;]|$)', 'g'), () => host);
    }, text);
}
