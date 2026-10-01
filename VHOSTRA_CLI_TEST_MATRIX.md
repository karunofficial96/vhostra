# CLI test matrix — 2026-10-01

This lists every route in `scripts/vhostra.mjs`. `Verified` means an automated test or the isolated live fixture exercised that behavior. `Pending` means the parser route exists but this phase did not exercise the complete live outcome. The common `--help` path passed for every command family; the parser rejects malformed arity before backend work. The common formatter and secret redactor have focused tests. Each route still needs its own live success, failure and exit-code checks before the CLI audit can be called complete.

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

A local unsigned macOS desktop package now includes `Vhostra.app/Contents/Resources/bin/vhostra`; `test/packaged-cli.mjs` invokes it as `vhostra` through a temporary PATH symlink from outside the checkout. Help, overall and individual human service status, MariaDB Not Created, and syntax/exit-code paths passed without npm or manually invoked Node. The package does not install a global PATH entry automatically. Linux and Windows launchers are included in packaging configuration but have not been built or verified natively. Existing pending live mutation rows above remain pending; they have not been converted to verified merely because their parser and launcher work.
