<?php
// Only the selected frontend can reach this loopback listener. Route only PHP
// scripts within a generated document root; static files remain frontend-owned.
$roots = json_decode(file_get_contents('/etc/vhostra/php/roots.json'), true, 512, JSON_THROW_ON_ERROR);
$host = strtolower(explode(':', $_SERVER['HTTP_HOST'] ?? 'localhost')[0]);
$root = $roots[$host] ?? null;
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/');
if (!$root || str_contains($path, "\0") || preg_match('~(?:^|/)\.\.(?:/|$)~', $path)) {
    http_response_code(404); exit('Not found');
}
if (!preg_match('~^(.*?\.php)(/.*)?$~i', $path, $parts)) {
    http_response_code(404); exit('Not found');
}
$script = realpath($root . $parts[1]);
$realRoot = realpath($root);
if (!$script || !$realRoot || !str_starts_with($script, $realRoot . '/') || !is_file($script)) {
    http_response_code(404); exit('Not found');
}
ini_set('error_log', '/var/log/vhostra/sites/' . ($host === 'localhost' ? 'vhostra-localhost-vhost' : basename($root)) . '/error.log');
$_SERVER['DOCUMENT_ROOT'] = $root;
$_SERVER['SERVER_NAME'] = $host;
$_SERVER['SERVER_PORT'] = parse_url('http://' . ($_SERVER['HTTP_HOST'] ?? 'localhost'), PHP_URL_PORT) ?? (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https' ? 443 : 80);
$_SERVER['SCRIPT_FILENAME'] = $script;
$_SERVER['SCRIPT_NAME'] = $parts[1];
$_SERVER['PHP_SELF'] = $path;
if (isset($parts[2])) $_SERVER['PATH_INFO'] = $parts[2];
if (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https') {
    $_SERVER['HTTPS'] = 'on'; $_SERVER['REQUEST_SCHEME'] = 'https';
}
// Apache's original request line survives internal rewrites and includes the query.
// Nginx supplies its original $request_uri and clears the request-line header.
if (preg_match('~^\S+\s+(\S+)\s+HTTP/\d~', $_SERVER['HTTP_X_VHOSTRA_REQUEST_LINE'] ?? '', $request)) {
    $_SERVER['REQUEST_URI'] = $request[1];
} else {
    $_SERVER['REQUEST_URI'] = $_SERVER['HTTP_X_VHOSTRA_REQUEST_URI'] ?? $_SERVER['REQUEST_URI'];
}
chdir(dirname($script));
require $script;
