# Gate 3A.2 machine runtime writer audit — 2026-10-07

Gate 3A.1 remains **DESIGN COMPLETE / IMPLEMENTATION BLOCKED ON APPLE
SIGNING**. Its signed protected-read service is mandatory before activation.
This audit does not open the native Store/runtime guards. The legacy Store and
the empty inactive `/Library/Application Support/Vhostra` root stay unchanged.

The paths below are relative to the fixed machine root on macOS. On Linux and
Windows, `systemStoragePaths` supplies separate fixed roots; the writer split
must be carried through those layouts before activation on those systems.
Modes are the intended host policy (`d/f` means directory/file). `root-private`
means an ordinary account cannot read or write the authoritative content.
Docker access is always to a *specific* bind, not to the whole parent tree.
`preserve` means helper/app uninstall leaves the data; `rebuild` means a
verified generator or image can recreate it without deleting user data.

| Path / purpose | Authoritative owner; writer | Legitimate readers | Host mode d/f | Class | Docker bind | Migration / uninstall | Current evidence and gap |
| --- | --- | --- | --- | --- | --- | --- | --- |
| root and `data/` parent | root; bounded setup | traversal for approved mounts only | `0755` / none | structural | parent sharing only | create during migration; preserve | Gate 2 uses root and `data/` traversal, with private children |
| `settings.json`, `onboarding.json` | root; protected Store transaction | approved main through Gate 3A.1 | root-private / `0600` | persistent authoritative | none | copy/verify; preserve | ordinary Store cannot read yet; guard stays closed |
| `sites/*.json`, `virtual-hosts/*` | root; protected Store transaction | approved main through Gate 3A.1 | `0700/0600` | persistent authoritative | none | copy/verify; preserve | no container bind to records |
| activation marker, migration journal/result | root; bounded migration/activation transaction | approved main through Gate 3A.1 | private parent / `0600` | persistent authoritative | none | verify/recover; preserve | Gate 2 has ready-only journal; no active commit |
| `configuration/source`, `custom`, `imported` | root; bounded protected writer | privileged generator only | `0700/0600` | persistent source | none | copy/verify; preserve | runtime must not write directly |
| `configuration/runtime/{openlitespeed,apache,nginx,php}` | root; bounded web generator | privileged generator | `0700/0600` | generated authoritative | none | regenerate/verify; rebuild | existing web transaction publishes this separately |
| `runtime-config/web/*` | root; bounded web generator | selected container read | `0755/0644` | generated projection | read-only per-server binds | regenerate/verify; rebuild | Gate 1/2 verified selected mounts; never contains keys |
| `configuration/runtime/mariadb/vhostra.cnf` | root; bounded MariaDB policy generator | privileged generator | `0700/0600` | generated authoritative | none | regenerate/verify; rebuild | Gate 1/2 protected delivery passed |
| `runtime-config/mariadb/vhostra.cnf` | root; bounded MariaDB projection | MariaDB container read | `0755/0644` | generated projection | read-only file | regenerate/verify; rebuild | exact non-secret projection passed |
| `configuration/generated/*` | root; bounded preview/selection transaction | approved main through Gate 3A.1 | `0700/0600` | generated metadata | none | regenerate/verify; rebuild | cleanup uses exact owned files |
| `certificates/public/*` | root or bounded cert publisher; web container read | web root/worker as needed | `0755/0644` | persistent identity | machine Compose now read-only | copy/verify; preserve | Gate 2 currently assigns service UID `999`; external publisher is still missing, so guarded machine runtime cannot start with TLS |
| `certificates/private/*` | root; bounded cert publisher | selected web root master only | `0700/0600` | persistent secret | machine Compose now read-only | copy/verify; preserve | machine entrypoint refuses key generation; bounded publication and per-certificate isolation remain unresolved |
| `service-data/localhost/public/*` | bounded built-in publisher; web/PHP runtime for required app files | web/PHP and local browser via HTTP | `0755/0644` for public files; secret files separate | persistent managed content | read-write built-in mount today | copy built-in only; preserve | ordinary `generate` writes health files; entrypoint writes phpMyAdmin config here. Needs separate service-side publication and secret-safe location |
| external Site document roots | that Site's OS owner; user/service per Site | selected web/PHP worker | retain existing owner/mode | external user content | selected bind, read-write where PHP needs writes | never copy/modify roots during migration/uninstall | Gate 1/2 staging left real roots untouched |
| `logs/sites/<id>/{access,error}.log` | selected worker: OLS `nobody`, Apache/Nginx `www-data`; container entrypoint | worker, privileged diagnostics | `0700/0600` | persistent managed log | read-write selected web bind | preserve by default | Native OLS/Apache/Nginx recreation passed with `0600` logs; machine controller remains guarded |
| `logs/{web,php,openlitespeed,nginx,apache,supervisord,...}` | service root master / selected worker | service; bounded diagnostics | private, no world write | persistent managed log | read-write selected web bind | preserve by default | supervisor and web server create these; host app must not create/chmod |
| `logs/mariadb/*` | MariaDB container `mysql` where applicable | MariaDB / bounded diagnostics | `0700/0600` | persistent managed log | read-write MariaDB bind | preserve by default | Gate 2 writer `999:999`; container owns rotation |
| `data/mariadb/*` | inspected MariaDB `mysql` `999:999` | MariaDB only; approved backup boundary | `0700/0600` | persistent database | read-write MariaDB bind | copy/verify; **preserve** | Gate 2 validated; ordinary app must neither create nor chmod this tree |
| `runtime/mariadb/{compose.yml,image/*,root-password,secrets.env,pma-provisioned}` | mixed: coordinator for Compose/image; bounded secret publisher for credentials | Docker CLI; MariaDB secret read | separate private work area; secrets `0600` | generated/transient + persistent secret | only root-password read-only bind | preserve credentials; rebuild Compose/image | **unsafe mixed writer**: Gate 2 owns the entire `runtime` tree as `999:999`, but ordinary `prepareDatabase` writes it |
| `runtime/{compose.yml,image/*,.env,healthy-state.json}` | runtime coordinator; secret publisher for `.env` | Docker CLI / coordinator | per-purpose private work area, `0600` for env | transient generated + secret | build context/Compose input, not service bind | rebuild; preserve secrets until rotation | currently in service-owned `runtime`; ordinary `generate` writes all of it |
| Redis config `runtime-config/cache/redis.conf` | bounded cache policy transaction | Redis process read | root `0755/0644`; no secret | generated projection | read-only file | regenerate from settings; rebuild | Disposable cache recreation passed; rebuilt production image and guarded controller remain untested |
| Redis persistent data | Redis process `101:102` if future persistence enabled | Redis only | dedicated `0700/0600` if enabled | **not enabled** | none today | no persistent data to migrate; future change needs migration | inspected image account `101:102`; old supervisor launched process `0:0`, changed next image policy to `user=redis`; no persistence bind |
| Redis runtime sockets/PID/cache | Redis process | Redis | container-private | transient | no host bind | discard on recreation | policy uses loopback TCP, `appendonly no`, `save ""`; no persisted host state |
| Historical `service-data/redis/*` and `service-data/memcached/*` from legacy migration | original source owner, copied with Gate 2 service-data policy | recovery/backup only | service-private `0700/0600` | preserved legacy artifact | none after generated cache switch | copy/verify and preserve; review before any later deletion | Gate 2 retains unknown historical bytes rather than silently discarding them |
| Memcached config `runtime-config/cache/memcached.conf` | bounded cache policy transaction | Memcached launcher read | root `0755/0644`; no secret | generated projection | read-only file | regenerate from settings; rebuild | Disposable cache recreation passed; guarded controller remains untested |
| Memcached values/PID | Memcached (`nobody` flag) | Memcached | container-private | transient | no host data bind | discard on recreation | memory cache intentionally ephemeral |
| OLS `/usr/local/lsws/{conf,logs,tmp}` | OLS root master/worker | OLS/PHP | container image/work layers | transient | no host work bind | discard/recreate | entrypoint copies generated config to writable container layer |
| Apache `/run/apache2`, `/var/log/apache2` | Apache root master/worker | Apache | container-private | transient | no host work bind | discard/recreate | generated host config is read-only |
| Nginx `/run`, `/var/cache/nginx`, `/var/log/nginx` | Nginx root master/worker | Nginx | container-private | transient | no host work bind | discard/recreate | generated host config is read-only |
| PHP-FPM `/run/php`, pool/config scratch | PHP-FPM master/worker | PHP-FPM | container-private | transient | no host work bind | discard/recreate | entrypoint writes pool in container layer |
| MariaDB `/run/mysqld`, PID/socket | MariaDB `mysql` / container root | MariaDB | container-private | transient | no host bind | discard/recreate | persistent SQL lives only in `data/mariadb` |
| Vhostra application diagnostics/screenshots/backups | current OS account | same account | user-private `0700/0600` | per-user persistent | none | preserve by default | already under each account's user data |

## Direct-write audit

`DockerRuntimeController` rejects `layout.userRoot` in its constructor. That
is the current fail-closed boundary, not a working machine runtime. Removing
the guard would let ordinary `generate`, `ensureEnvironment`,
`prepareDatabase`, recovery and service-config operations write below the
machine root. It would also make one account's Compose working directory and
secrets collide with another's. The exact mutation inventory is in
`electron/runtime.ts`; writing to `runtime/mariadb`, `runtime/{image,compose}`,
`service-data/localhost/public` and `logs`
must be eliminated or delegated before the guard can be removed.

The existing bounded transactions cover authoritative settings/Sites, web
generation, MariaDB policy and generated projections. They do **not** cover
runtime image/Compose workspaces, first-use secret generation, certificate
renewal, built-in health content or log provisioning. Cache configuration now
has a fixed bounded generator and read-only projection, but is not yet part of
a validated machine runtime lifecycle.
Those need new *semantic* operations or service/container ownership, never a
generic root filesystem API. A shared mutable Compose file or secret readable
by any local user is unacceptable. The signed Gate 3A.1 service remains a
separate requirement for routine shared Store reads and may also be needed
for approved-user access to selected runtime metadata; this writer audit does
not use or implement it.

## Isolated validation and remaining work

The disposable cache test passed with zero Vhostra elevation: its only mounts
were the generated cache files, read-only. An inspected existing image has a
`redis` account `101:102`; its old supervisor launched Redis as root. The next
image policy sets `user=redis`, and a container launched as `101:102` passed
Redis set/recreation with the value absent afterward. Redis persistence stays
disabled. Memcached set/recreation also passed with the value absent. A new
image built from the changed supervisor has **not** yet been validated.

The isolated inactive-root web fixture started, stopped and recreated OLS,
Apache and Nginx with PHP/PHP-FPM. Each served the disposable Site on both
starts, the expected worker owned Site logs, and those files remained `0600`.
The entrypoint now creates the exact fixed localhost log directory and
validated generated Site-ID directories; the ordinary machine runtime branch
skips log precreation. A root-owned fixture first exposed a missing built-in
log directory; the fix passed Docker-only Apache/PHP and then all three native
server recreation checks. The worker exited and removed its fixture.

The inactive-root MariaDB fixture created a disposable database/table,
inserted and read one value, recreated the container, then read the same value.
It verified `mysql` `999:999` in the inspected image, the read-only generated
config mount, root-private authoritative config, and non-world-writable data.
The initial test raced MariaDB's temporary bootstrap server; the final check
waits for the final TCP gateway before inserting. Gate 2's native synthetic
migration, including six failure/recovery cases, passed again after the cache
projection was added. None of these fixtures selected the machine Store or
touched the real legacy Store, real database, or external website roots.

**Gate 3A.2 is still incomplete.** The runtime constructor guard remains
closed. The ordinary controller still assumes it can write the mixed-owner
`runtime` workspace, first-use/shared database secrets, built-in public health
content, certificate material and some recovery files. Those writes have not
been replaced with semantic protected publication, container ownership, or a
safe per-user transient workspace. The machine certificate tree now has a
read-only container mount and a consumer that refuses to generate keys; it
still needs a bounded publisher and narrower per-certificate exposure before
claiming a complete authoritative boundary. A
second approved account's Docker working-directory/secret coordination is
unresolved. Isolated container recreation does **not** prove that the guarded
machine `DockerRuntimeController` can replace services. Do not remove its
guard, infer activation readiness, or migrate real data from these results.
