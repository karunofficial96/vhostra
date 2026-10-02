# CLI test matrix — 2026-10-02

## Current isolated live acceptance

`test/cli-live-matrix.mjs`, `test/cli-sites-live.mjs`, `test/cli-php-switch-live.mjs`, and `test/cli-server-aliases-live.mjs` ran sequentially with separate temporary `VHOSTRA_USER_DATA` and `VHOSTRA_RUNTIME_PROJECT` values. They removed their exact containers and networks. Site/Hosts mutation used a private temporary Hosts file; the real `/etc/hosts` was not changed.

| Routes | Live result |
| --- | --- |
| Help and syntax | All command families returned local help; malformed arity exited 64. |
| `status [target]`, `runtime status`, `service list`, individual status aliases | Running, inactive, disabled and Not Created text/exit behavior exercised; packaged launcher returned readable status outside the checkout. |
| Full `start`, `stop`, `restart`; `runtime` aliases | All three actions passed against one isolated running project. |
| `web`, `mariadb`, `service web`, `service mariadb` lifecycle aliases | Stop, Start, Restart and status passed; MariaDB was also Stopped for a nonzero `database list` prerequisite check. |
| Active `openlitespeed`, `apache`, `nginx` targets | Each selected server passed status, Stop, Start and Restart. An inactive Apache start returned nonzero. |
| `redis`, `memcached`, `service` cache aliases | Enable, status, Stop, Start, Restart and Disable passed. Start while disabled returned nonzero. Actual PHP localhost connectivity is covered by the three-server HTTP fixture. |
| `sites list/add/edit/remove/repair`, `vhost list`, `hosts status/repair` | Live add/edit/repair/remove and actual Site HTTP routing passed with a private Hosts file; interactive removal kept the external document root. An unowned hostname was rejected. |
| `config export/preview/import`, `import preview/apply` | Portable configuration round trip and native Apache Site import passed in the isolated profile. Invalid native preview and syntax paths have separate tests. |
| `database list/create/import/export/repair/delete` | All six live routes passed, including hidden TTY password and confirmed deletion. Stopped/Not Created prerequisites returned nonzero; invalid SQL handling is covered by the controller fixture. |
| `php status/versions/select`, extensions, OPcache, `cwebp` | CLI PHP 8.5→8.4→8.5 returned the selected version through Nginx PHP-FPM HTTP. APCu install/disable/enable/remove, OPcache and `cwebp` toggles passed. Invalid version returned nonzero. Apache/Nginx extension lifecycles passed through HTTP inventory in the controller fixture. |
| `reset` | Earlier isolated live `test/persistent-controls-runtime.mjs` passed both exact interactive Keep and Remove confirmations and database preservation/removal; cancellation and destructive-flag rejection have focused CLI tests. |

The remaining external CLI acceptance is protected real Hosts-file approval/cancellation, installed PATH integration on Windows/Linux, and signed release launchers. This matrix does not treat parser inspection as a live mutation result. The older table below records what was pending on 2026-10-01 and is superseded by the current results above.

## Historical baseline — 2026-10-01

This was the 2026-10-01 route inventory. `Verified` meant a test or isolated live fixture exercised that behavior at that date; `Pending` identified live outcomes still open then. The current acceptance table above supersedes those pending labels.

| Command routes (prefix `vhostra`) | Verified in this phase | Remaining live checks |
| --- | --- | --- |
| `help`, `--help`, `-h`; family `--help` | All families return local usage and exit 0 | Platform release help after launcher exists |
| `status`; `runtime status` | Packaged launcher from outside source reports human configured/runtime status and exits correctly for an isolated missing-runtime profile; no raw JSON | Full running/unhealthy matrix |
| `status apache`, `status nginx`, `status openlitespeed`, `status web`, `status php`, `status mariadb`, `status phpmyadmin`, `status redis`, `status memcached` | All packaged status targets exercised outside source; `status mariadb` Running in isolated real container | Other live targets, inactive selection, disabled/failed |
| `start`, `stop`, `restart`; targeted `start|stop|restart web|apache|nginx|openlitespeed|mariadb|redis|memcached` | Shared backend routing inspected; isolated MariaDB backend start/stop/failed start passed | Actual CLI mutations for every target and full runtime |
| `runtime start`, `runtime stop`, `runtime restart` | Parser/help reviewed | Live success/failure and exact inventory cleanup |
| `service list`; `service web|mariadb|redis|memcached status|start|stop|restart`; `service redis|memcached enable|disable` | Parser/help reviewed; common text formatter tested | Live status and mutation matrix |
| `web status|start|stop|restart`; `mariadb status|start|stop|restart` | Parser/help reviewed | Live CLI aliases; stopped and failed states |
| `sites list`, `sites add FILE`, `sites edit ID FILE`, `sites remove ID`, `sites repair [ID]` | Listing and invalid syntax/ownership checks | Live add/edit/remove/repair, cancellation and failure |
| `vhost list` | Isolated local listing | Live user-defined host display |
| `config export FILE`, `config preview FILE`, `config import FILE` | Parser/help reviewed | Live file content, conflicts and failure handling |
| `database list`, `database create NAME USER [charset]`, `database import NAME FILE`, `database export NAME FILE`, `database repair NAME`, `database delete NAME` | All six report Not Created without SQL placeholder or stack. Live `database list` succeeds while Running and reports Stopped with exit 1 and next action. | Other live database success/error paths, interactive create/delete, secrets and file validation |
| `php status`, `php versions`, `php select VERSION`, `php extensions list`, `php extension install|enable|disable|remove PACKAGE` | Packaged `php status` distinguishes configured/runtime state; invalid version, parser/help, common formatter; live PHP 8.4/8.5 replacement and extension catalog through controller | CLI extension/catalog and mutation matrix |
| `opcache status|enable|disable`; `cwebp status|enable|disable` | Parser/help reviewed | Live success, stopped-runtime and failure matrix |
| `redis status|enable|disable|start|stop|restart`; `memcached status|enable|disable|start|stop|restart` | Packaged `status` paths distinguish configured/runtime state; live enable/restart/disable transitions and PHP localhost connectivity passed through controller | CLI mutation aliases and failure cases |
| `hosts status`, `hosts repair [hostname]` | Isolated empty status and unowned-name rejection | Live owned mapping, elevation cancellation and conflict |
| `import preview PATH [server]`, `import apply PATH [server] [--accept-warnings]` | Native preview, invalid input and exit codes | Live apply, warnings, conflicts and rollback |
| `reset` | Both interactive cancellation stages preserve local state; destructive flags rejected | Isolated confirmed Keep/Remove CLI path under current formatter |

All CLI tests use isolated `VHOSTRA_USER_DATA` and `VHOSTRA_RUNTIME_PROJECT`. The live MariaDB fixture compared exact Docker inventory before and after cleanup. It created no Vhostra command history, Help search history, telemetry or network service.

## Runtime/settings follow-up — 2026-10-01

A local unsigned macOS desktop package now includes `Vhostra.app/Contents/Resources/bin/vhostra`; `test/packaged-cli.mjs` invokes it as `vhostra` through a temporary PATH symlink from outside the checkout. Help, overall and individual human service status, MariaDB Not Created, and syntax/exit-code paths passed without npm or manually invoked Node. The package does not install a global PATH entry automatically. Linux and Windows launchers are included in packaging configuration but have not been built or verified natively. The old pending labels above record the baseline before the current live fixtures.
