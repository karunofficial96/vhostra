# Supported macOS architecture

Vhostra supports **per-user Vhostra application state + user-selected Site
document roots + Docker-managed services** on macOS. Normal Electron and CLI
operations run as the OS user. This architecture does not depend on the
proposed signed privileged machine service or a paid Apple Developer /
Developer ID membership. A packaged app may still encounter macOS
distribution-trust warnings if it is unsigned or not notarized; signing and
notarization are separate distribution work, not runtime storage prerequisites.

## Locations used by production

Electron passes `app.getPath('userData')` to `VhostraStore`. Call this per-user
directory **U**. On macOS Electron normally places it under the account's
`~/Library/Application Support/` tree. The Store defaults its environment
root **R** to `U/Vhostra`; `U/vhostra-location.json` can instead point to a
user-selected absolute Vhostra configuration root. The chosen root is shown
in Help. The bundled CLI's macOS default user-data path is
`~/Library/Application Support/vhostra`; `VHOSTRA_USER_DATA` is for a
deliberately selected profile, not machine Store activation. Exact casing of
Electron's app directory comes from the packaged app name; inspect the
active path in Help rather than inferring it from this example.

| Data | Supported host location |
| --- | --- |
| Per-user preferences and root pointer | `U/vhostra-user-settings.json`, `U/vhostra-location.json` |
| Settings and onboarding state | `R/settings.json`, `R/onboarding.json` |
| Site definitions and older split vhost records | `R/sites/*.json`, `R/virtual-hosts/*.json` |
| Source, custom, imported, generated configuration | `R/configuration/{source,custom,imported,generated}` |
| Web/PHP and service runtime configuration | `R/runtime/{apache,nginx,openlitespeed,php,mariadb,phpmyadmin,redis,memcached}` |
| Web Compose and recovery metadata | `R/runtime/compose.yml`, `R/runtime/healthy-state.json` and bounded recovery data under `R/runtime` |
| MariaDB Compose and canonical secret environment | `R/runtime/mariadb/compose.yml`, `R/runtime/mariadb/secrets.env` |
| Persistent MariaDB database files | `R/data/mariadb` |
| Local certificates and keys | `R/certificates/public`, `R/certificates/private` |
| Vhostra and Site logs | `R/logs`, including `R/logs/sites/<Site ID>` |
| Built-in localhost content | `R/sites/localhost/public` |
| Previews, backups and exports | `R/cache/screenshots`, `R/backups`, `R/exports` |
| Website document roots | Each Site's user-selected `documentRoot`; Vhostra does not relocate it |

These paths come from `electron/store.ts` and `electron/runtime.ts`. Runtime
containers bind the selected Site roots at separate container paths and do
not move or own those website files. A server or PHP change does not migrate
the document root. Explicit Vhostra configuration-location migration is a
per-user feature; it is not machine Store migration.
On a case-sensitive macOS filesystem, the CLI's lowercase default user-data
directory may differ from Electron's packaged app-name directory; set
`VHOSTRA_USER_DATA` to the desktop's displayed user configuration directory
when deliberately using the CLI with that profile.

## Accounts, Docker, and privileges

Each macOS account normally has its own Electron `userData` and Vhostra
environment. Vhostra does not automatically share one account's settings,
Site registry, database bind mount, or certificates with another account, and
it does not promise a shared machine Store. A user may deliberately select a
different Vhostra root or Site document root; ordinary filesystem permissions
still govern access. Vhostra does not add cross-user sharing to simulate the
dormant design.

Docker is an external local daemon/context, separate from the per-user
Vhostra Store. Vhostra uses managed Compose projects named `vhostra` and
`vhostra-database` by default, host port bindings, and host bind mounts under
the selected Vhostra root. If two accounts can reach the same Docker daemon,
Docker resources, project names, and host ports are not guaranteed to be
isolated between those accounts. The per-user Store is not an isolation
boundary for the Docker daemon.

Electron itself does not run permanently as root. Existing short-lived,
bounded macOS authorization can be requested for operations that require it,
such as reviewed Hosts-file changes or an authorized CLI link. Those paths
do not provide a general root filesystem API or cache an administrator
password. Normal startup does not install a LaunchDaemon/XPC machine helper.

## Dormant engineering work

The previously explored machine-wide design needed a different privileged
service and authenticated client trust model. Vhostra has chosen not to
require that architecture for its supported macOS runtime. Its code, tests,
and Gate records remain preserved with activation guards closed. See the
[machine-wide freeze](machine-freeze.md); any resumption requires a new
explicit architecture decision.
