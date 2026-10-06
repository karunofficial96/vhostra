# Storage audit (2026-10-04)

This records the current implementation and the intended ownership. It is not
an assertion that the machine-wide migration is complete.

| Current record | Current location | Ownership | Required destination |
| --- | --- | --- | --- |
| `vhostra-location.json` | Electron `userData` | Obsolete path override | Remove after verified system migration; read only for legacy upgrades |
| `vhostra-user-settings.json` | Electron `userData` | Per-user | Keep; startup modes, close behavior, theme and onboarding completion |
| `settings.json` | Active `Vhostra` root | System | Fixed OS configuration directory; web server, PHP, extensions, caches, ports |
| `onboarding.json` | Active root | Machine setup marker and legacy theme | Retain machine readiness; per-user welcome, theme and completion now live in user settings |
| `sites/*.json`, legacy `virtual-hosts/*.json` | Active root | System/project metadata | System registry; external document roots remain untouched |
| `sites/localhost/public` | Legacy active root | Generated built-in Site | `service-data/localhost/public` under machine data; not an external project root |
| `configuration/{source,custom,imported,generated}` | Active root | System; imported source may be sensitive | System configuration/data, preserving ownership and source provenance |
| `runtime/{apache,nginx,openlitespeed,php,mariadb,phpmyadmin,redis,memcached}` | Active root | System runtime | System data/configuration as appropriate |
| `data/mariadb` | Active root | System persistent data, sensitive | System persistent data; must survive ordinary upgrades/resets |
| `certificates/{public,private}` | Active root | System; private keys secret | System persistent data, private permissions |
| `logs` | Active root | System; potentially sensitive | OS log directory with bounded rotation |
| `cache/screenshots` | Active root | Temporary/cache; may contain site content | Per-user cache or disabled under privacy policy |
| `backups`, `exports` | Active root | Recovery/user export; may be sensitive | Preserve existing files until explicit user action |
| Last file dialog directory | Electron `userData` | Per-user | Keep |
| Renderer `vhostra:appearance` | Electron browser storage | Per-user cache | The user settings file is authoritative after launch; remove redundant cache in a later cleanup |
| Selected website document roots | User-chosen paths outside managed storage | Project | Keep in place; never move during system migration |

The active store is still writable by the ordinary Electron process and may be
redirected by a legacy pointer. A safe system migration requires a narrowly
scoped privileged helper for verified copy, mutation, rollback and reset. The
current Hosts elevation mechanism does not grant those operations. Moving the
root alone would leave ordinary settings and runtime writes unable to run.

## Continued migration work (2026-10-04)

The built-in localhost document root now resolves through `layout.builtinPublic`.
For a split machine layout it lives in `data/service-data/localhost/public`,
alongside other service-writable content. The preparation copier moves the
legacy built-in files there and rewrites only the verified built-in Site record
to the new path. It checks the transformed record on idempotent runs and
preserves the legacy source. External Site roots are still excluded.

`prepareSystemMigration` now copies only inventoried managed files to separate
configuration, data and log destinations. It checks source file identity and
hashes, refuses links and occupied destinations, verifies copied bytes, rolls
back destination activation after a failed runtime callback, and leaves the
legacy source untouched. A prepared marker contains no user path or contents.
The fixed Windows path literal was corrected. Fixture tests cover MariaDB bytes,
external Site exclusion, idempotence, occupied destinations, links and rollback.

**The application still uses its legacy writable root.** This copy primitive is
not called at startup. It is not an elevated writer. Store, runtime and Docker
paths still issue ordinary process writes, and the current Hosts elevation
mechanism is separate. Activating protected directories now would break those
writes; doing so without a scoped privileged transaction would weaken the
security boundary. Crash recovery across all three Linux roots, combined Hosts
and storage elevation, native MariaDB startup validation and multi-user native
acceptance remain unimplemented. Do not treat a prepared copy as an active
migration or remove the source.

## Split layout continuation (2026-10-04)

The store can now be constructed with separate machine configuration, data and
log roots. Runtime paths, MariaDB containment, and Docker executable preference
lookup use those roots; previews, exports, backups, and Docker executable
selection remain per user. A fixture opens a migrated environment through the
split layout, reads the shared settings and MariaDB bytes, retains an external
Site root, and demonstrates independent personal theme/startup settings for two
users. This is a layout test with writable temporary directories.

Production startup deliberately still constructs the legacy layout. The split
layout is not a privilege mechanism: store, runtime, log, and Docker-related
writes still use ordinary filesystem calls. Activating it against protected OS
paths would fail and could leave a partial runtime. The release remains blocked
on a trusted, narrowly scoped privileged transaction covering those writes and
Hosts changes, with recovery and native validation on each OS.

## macOS continuation check (2026-10-04)

The migration copier now stages the nested macOS configuration/data/log paths
under a single root and verifies an idempotent copy. A read-only preflight of
the current legacy environment inventoried 4,832 managed files (305,318,876
bytes), including MariaDB data; two external website roots were excluded. The
live legacy root was not changed, and `/Library/Application Support/Vhostra`
does not yet exist.

Activation remains blocked: the elevated worker currently allows only three
JSON object types and Hosts edits; production Store construction and the many
runtime writes still use the legacy writable layout. A root-owned copied macOS
tree would also prevent ordinary runtime and MariaDB writes. The system root
must not be selected until protected configuration mutations and writable
runtime/data ownership have been wired and verified with a real native launch.

## Production write classification and activation gate (2026-10-04)

The following covers filesystem mutation call sites in `electron/store.ts`,
`runtime.ts`, `generated-config.ts`, `logs.ts`, `backup.ts`, `hosts.ts`,
`main.ts`, `startup.ts`, `file-dialogs.ts`, `docker-prerequisite.ts` and
`cli-integration.ts`. Docker itself also writes bind-mounted MariaDB and log
paths. Paths are classified by *what is being changed*, rather than by their
current position under the legacy root.

| Category | Mutations and source | Required treatment |
| --- | --- | --- |
| **A Protected configuration** | `settings.json`, `onboarding.json`, `sites/*.json`, legacy `virtual-hosts/*.json` (`store.ts`); generated vhost and service policy under `configuration/generated` and `configuration/runtime/{apache,nginx,openlitespeed,php,mariadb}` (`runtime.ts`, `generated-config.ts`); server selection and reset/deletion of these records | Active machine configuration changes use exact-name operations in the existing privileged transaction. The original generated web/PHP/MariaDB write sites are converted. Machine reset and legacy Site consolidation still fail closed pending lifecycle work. |
| **B Persistent service data** | `data/mariadb/**` and MariaDB bind-mount writes (`runtime.ts`, Docker); cache profiles under `service-data/{redis,memcached}`; `certificates/**` | Dedicated service-writable directories with ownership and permissions limited to their writers. The database container UID and host ownership must be validated against the actual migrated image before activation. Private certificate material must not be made service writable unless a specific operation requires it. |
| **C Runtime/transient state** | `runtime/compose.yml`, `.env`, image working copies, recovery markers, health state, MariaDB bootstrap secrets, `runtime/mariadb/image`, generated localhost health scripts and welcome files, temporary import/restore files (`runtime.ts`, `store.ts`, `backup.ts`) | Move ephemeral files to a narrowly writable runtime/data location; keep secret files mode `0600`. Generated service configuration listed under A must remain protected. Do not elevate per health check or database operation. |
| **D Logs** | Site access/error logs, MariaDB and web server logs (`runtime.ts`, `logs.ts`, Docker) | Designated log root and bounded rotation. The web image initializes Site log files at `0600`, owned by `nobody:nogroup` for OpenLiteSpeed and `www-data:www-data` for Apache/Nginx; PHP-FPM follows the selected server's log identity. Site directories are `0700`. The host repairs legacy `0666` files before launch. Isolated local-request and non-root append tests passed for all three servers. Root-owned macOS system-root ACL validation remains pending. |
| **E Per-user state** | `vhostra-user-settings.json`, screenshots, exports, backups, migration pointer, file-dialog state, Docker executable choice, autostart entry, CLI integration, temporary Hosts recovery (`store.ts`, `backup.ts`, `main.ts`, `file-dialogs.ts`, `docker-prerequisite.ts`, `startup.ts`, `cli-integration.ts`, `hosts.ts`) | Retain in the user's profile or explicit user destination. These do not need administrator authorization. Legacy per-user migration must be disabled once machine storage is active. |
| **F Website/project files** | External document roots selected by the user | Never copy, chmod, chown, delete, or rewrite during storage migration. The two identified external roots are excluded by the inventory. |

`hosts.ts` changes the OS Hosts file through the existing privileged transaction;
Hosts is a protected OS resource outside the Vhostra storage categories. The
older separate Hosts shell path remains in the source and must be removed or
made unreachable for production combined operations.

### Baseline direct protected writes before refactoring

The Store's three allowlisted JSON record types now route through the existing
privileged transaction when constructed with `machinePaths`. Its machine-mode
reset and legacy Site consolidation fail closed; they are not silently run as
ordinary filesystem mutations. At this baseline, the runtime performed direct
Category A configuration writes in `generate()`, `writeServerConfiguration()`,
cache config restore, and generated-config cleanup. These were **activation
blockers**. There is still no native ownership setup for B/C/D, and production startup still constructs
the legacy Store. The audit identifies **35 remaining ordinary Category A
mutation call sites** in `runtime.ts` and `generated-config.ts`, including
`writeIfMissing`, directory creation, rename and cleanup. A loop or Site map
can execute a call site many times. Docker's own writes are classified
separately above. The count must reach zero before the macOS system root can
be activated or used for a native MariaDB start. The runtime constructor now rejects a split machine
layout before it can generate any files. A source regression test checks this
gate and checks that production startup still uses the legacy layout.

### Executable mutation inventory

`test/runtime-write-audit.test.mjs` pins every direct `fs` mutation call in
`runtime.ts` (42) and `generated-config.ts` (2) by its source expression. A new
call fails the source suite until it is classified here and the inventory is
deliberately updated. This is an inventory guard, **not** the zero-write
acceptance test: generated web-server configuration and PHP policy/logrotate
configuration have been converted, but other protected call sites remain,
and helper functions and container writes require separate review. The machine
runtime gate stays shut.
Constructing a Store against the actual native system roots now also fails
closed; temporary split-layout fixtures remain available for testing.

| Current call group | Category | Required disposition before activation |
| --- | --- | --- |
| `writeServerConfiguration()` files in `configuration/generated` and server-specific `.conf` files, including per-Site OpenLiteSpeed files | A | Converted to one generated configuration transaction; obsolete owned names are cleaned in one later transaction after health validation. |
| PHP policy `.conf` writes in `runtime.ts` | A | Converted to the generated protected batch. |
| Redis/Memcached profile writes and backup restore in `runtime.ts` | B | Moved to `service-data/{redis,memcached}` in the machine layout; these private service profiles remain writable by the scoped runtime identity and never enter a privileged payload. |
| Generated configuration cleanup and preview rollback in `generated-config.ts` | A | Converted to exact-name, ownership-checked transaction operations in machine mode. Full protected runtime replacement recovery still needs native lifecycle work. |
| Compose YAML, `.env`, image copies, health/recovery markers, MariaDB bootstrap secret and `root-password` | C (MariaDB secret is persistent) | Keep in scoped writable runtime/data storage with secret files at `0600`; do not place these under protected configuration. |
| MariaDB datadir | B | The locally built `vhostra-mariadb:build-9ff702f406620439713a98a0` image runs `mysql` as UID/GID `999:999`. A disposable Docker Desktop bind mount completed real SQL create/insert and showed a `0700` datadir; do not assume this numeric identity for another image build. |
| Site access/error and MariaDB logs | D | Use the dedicated log root and bounded rotation. Host-side legacy files are repaired to `0600`; container startup sets Site log ownership to the selected server/PHP worker: `nobody:nogroup` (`65534:65534`) for OpenLiteSpeed or `www-data:www-data` (`33:33`) for Apache/Nginx in the inspected local images. Independent runtime fixtures confirmed local requests and non-root append without world permissions. |
| Generated localhost health scripts | C | Keep in managed built-in runtime data, separate from external Site document roots. |
| User-selected Site document roots and export destinations | F | Keep at their selected paths; never include them in a privileged storage transaction. |

For macOS the target ownership is root-owned, non-group-writable protected
configuration; a separately scoped runtime/data directory writable by the
interactive user; a MariaDB datadir writable by the actual database worker
through Docker Desktop's bind-mount mapping; and a log directory writable only
by the verified container writers and local user. A group or ACL must grant
only the needed directories/files. No general recursive chmod or world-write
permission is acceptable. The disposable Docker Desktop tests validate local
image writer identities and all three web servers, but the fixed root-owned
macOS system layout is **not yet validated**.
Neither the fixture nor the existing copier authorizes real activation. Windows and Linux should use equivalent ACL/service
identity separation without changing the transaction's path allowlist.

The privacy regression was the Site log precreation in `runtime.ts`: it
explicitly set both access and error logs to `0666`, so any local account could
read request paths and alter logs. This was introduced to let an unprivileged
web worker append. The runtime now repairs legacy files to `0600` and leaves
new file creation to the container, which assigns them to the selected server
and PHP worker.
No website document root is changed by this repair.

### Native macOS permission staging

`npm run test:native-permissions` is an explicit manual check, separate from
`npm test`. It waits for interactive macOS administrator authorization,
creates a uniquely named root-owned `.Vhostra-permission-stage-*` sibling under
`/Library/Application Support`, tests ordinary-write denial and the existing
allowlisted transaction executor, and removes that staging tree. It does not
select or create the live `/Library/Application Support/Vhostra` store. MariaDB
is run as the ordinary account in a disposable container with bounded SQL
checks. The worker emits milestone timings and no transaction or credential
contents.

On this host, the native authorization probe initially timed out after 20
seconds because SecurityAgent was waiting for manual approval. Once approved,
it returned successfully. The manual staging worker then passed root-owned
configuration checks but Docker Desktop rejected the bind mount under
`/Library/Application Support` as outside its shared host paths. The worker
removed its stage; Docker had created three stopped container records before
rejecting their mounts, which were removed by exact name. The command now arms
container cleanup before `docker run` so this failure path is also covered.
The developer observed more than one macOS administrator dialog during the
latest full staging invocation, although the harness calls `osascript` once.
The source of the additional dialogs has not been established and must not be
reported as a one-prompt result. An explicit `--without-docker` staging run
completed the protected checks and exited; the developer counted exactly one
macOS administrator dialog during that single run. The harness, its root worker and cleanup issue
no second elevation request. The Docker CLI and Docker Desktop may have their
own prompts, but process inspection alone does not prove which UI displayed
them.

Docker Desktop's documented default shared macOS locations include `/Users`,
`/Volumes`, `/private`, `/tmp` and `/var/folders`; `/Library/Application Support`
is outside that default set. Its file-sharing policy explains the staged bind
mount rejection. A user-controlled File Sharing entry scoped to the Vhostra
system root is narrower than sharing all of `/Library` or `/Library/Application
Support`, but it has not been configured or validated. The current production
Compose mounts include protected configuration, the MariaDB datadir, the
bootstrap secret and logs, so sharing only `data/mariadb` would not suffice.
The disposable staging sibling would itself need a temporary exact-path share
for a native SQL check; such a share must be removed afterward. We will not
change Docker Desktop's global settings automatically.

Apple documents `/Library/Application Support` for machine-wide application
support and advises against `/Users/Shared` for support files. Moving data into
a default Docker-shared user location solely to make the bind mount pass would
undercut the system-store design. A separate machine-wide persistent-data root
remains an architecture option only after its OS suitability, ownership,
privacy, backup, migration and uninstall behavior are established. Docker
named volumes keep data in Docker Desktop's VM and require a separate backup
and migration path; they are not a drop-in replacement for preserved host data.
The fixed system root must not be activated until Docker Desktop can mount its
scoped resources without broadening unrelated directory access and staged SQL
passes there.

On 2026-10-06, a separate Docker-only `docker run --rm --pull never --network
none` probe requested a read-only bind of the exact proposed
`/Library/Application Support/Vhostra` path and ran no Vhostra authorization
code. The developer observed one macOS administrator dialog and no separate
Docker Desktop dialog. The daemon rejected the request at container creation
because the source path does not yet exist, before checking file sharing.
Thus this run shows a Docker-only operation can coincide with an administrator
dialog, but does not identify the dialog's requester or validate the narrow
share. The live Vhostra root was not created. Docker Desktop settings were not
changed. The next gate is a user-controlled File Sharing entry for the exact
Vhostra root, if Desktop accepts a not-yet-existing path; do not substitute the
parent `/Library/Application Support` directory. The native staged MariaDB and
production-launcher checks remain unrun.

For user-controlled Docker File Sharing setup, `node scripts/native-staging.mjs
--prepare-system-share` uses one short-lived administrator-authorized staging
worker to create only the empty `/Library/Application Support/Vhostra` directory
as root-owned `0755`. It refuses a pre-existing root and changes no Store
pointer, migration state, production startup or Docker setting. The production
`main.ts` constructs `VhostraStore` without machine paths; `VhostraStore`
selects its legacy per-user layout without checking for existence of the native
system directory, and its constructor still rejects an explicit native machine
layout. Directory existence alone therefore cannot activate system storage.
After creation, pause for the developer to add exactly this root in Docker
Desktop → Settings → Resources → File Sharing. Do not create test children or
run Docker until that manual step is confirmed.
The one-off preparation completed: the root is empty, owned by root with mode
`0755`, and the helper exited. A read-only Store construction check still
selected its legacy layout while the inactive directory existed. No Docker
probe, MariaDB container, migration, or production startup change followed.

After the developer added the exact root to Docker Desktop File Sharing, an
isolated staged bind probe under that root failed at Docker container creation:
the daemon reported the child missing under `/host_mnt/Library/Application
Support/Vhostra`. A second Docker-only read-only probe of the existing empty
root returned the same `bind source path does not exist` result for the root
itself. Docker Desktop still listed the exact share with no pending change. The
developer then restarted Docker Desktop; a read-only bind of the existing root
passed, followed by a bind of a disposable child beneath it. No broader path
was shared or Docker setting edited by Vhostra.

The production-style MariaDB container mount of protected, root-owned `0600`
`configuration/runtime/mariadb/vhostra.cnf` failed: Docker Desktop's unprivileged
file sharing reported permission denied while creating that bind source. Its
parent was root-owned `0755`, so relaxing directory traversal did not solve
file access. The protected file was not made broadly readable. A separate
staged MariaDB run mounted only disposable host-backed data, logs and a private
bootstrap secret. It started, used the inspected image's `mysql` identity
`999:999`, completed disposable create/insert/read SQL, stopped, and found no
world-writable data entries. Its container had no protected configuration
mount, and the protected file remained root-owned `0600`. The developer
clarified one authorization dialog total for that successful run, with none
after the initial staging authorization during Docker or SQL. This proves
host-backed database operation, but the production Compose config mount remains
an activation blocker.

The actual production launcher was then exercised separately against a
root-owned disposable stage. One allowlisted generated-configuration logical
transaction completed, an arbitrary target was rejected before authorization,
ordinary protected writes were denied, the staged file verified root-owned
`0600`, and the launcher and staging helpers exited. The stage was removed; the
inactive root remained empty. The native stage target is restricted to an exact
UUID child under the inactive root and generated configuration operations; the
normal launcher path continues to use the fixed native system paths. The
production Store still constructs in legacy mode. No live migration occurred.

### Generated configuration conversion (2026-10-04)

The 16 direct mutations in `writeServerConfiguration()` and the two PHP policy
and logrotate writes in `generate()` were replaced with in-memory construction.
Machine mode submits the exact generated file set in one `generated-web-config`
operation to the existing short-lived protected worker. The worker accepts only
fixed web/PHP names and UUID Site files under protected configuration, checks
ownership before replacement, rejects links and duplicate destinations, and
rolls back a failed batch. The legacy mode retains its ordinary writable root
and writes the same generated bytes there. The migration copier now places
Apache, Nginx, OpenLiteSpeed and PHP configuration under
`configuration/runtime`; Compose/image/database runtime files stay in data.
No production machine runtime was started, and the machine gate remains active.
The static MariaDB `vhostra.cnf` is placed under protected configuration and
published through a separate exact-name MariaDB runtime-config transaction.
MariaDB's datadir, Compose/image files and bootstrap secrets remain in service
data. Generated-file cleanup and preview rollback now use an owned, exact-name
protected transaction in machine mode. Legacy cleanup retains two ordinary
mutation call sites behind its machine branch. The remaining protected-write
count is **0** against the initial 35-call-site
baseline; this count excludes the two legacy-only writes behind the machine
branch in the refactored method and the two legacy-only cleanup writes. The inventory's 43 `runtime.ts` calls also
include normal data/log/export mutations, so it is not itself the protected
write count.

The final 11 were disposed as follows: five cache backup-restore mutations and
four cache generation mutations now target `service-data/{redis,memcached}`
(persistent service data, B), with private files and a scoped directory mode;
the ordinary directory-creation loop now excludes protected web/PHP directories
(writable runtime/data/log preparation, C); and the obsolete PHP `roots.json`
is excluded from machine migration while the legacy-only cleanup stays in the
writable legacy runtime (transient state, C). No machine-mode ordinary mutation
path remains for the original 35. **This is a source and fixture result, not
permission approval or system-storage activation.** The native MariaDB writer,
interactive user, Docker Desktop bind mapping and log writer permissions still
need verification before the machine runtime gate can be removed.
The zero count is limited to the original 35 runtime call sites. The built-in
localhost welcome and health files now use machine service data, and the
preparation copier rewrites the verified built-in Site record. A broader
activation review still has work: machine-mode runtime replacement must
restore protected server configuration as well as its generated preview on
rollback. Full migrated service-data ownership and web-runtime mounts have not
been validated. The fail-closed Store and runtime gates remain.

### MariaDB configuration delivery boundary (2026-10-06)

The authoritative MariaDB configuration is root-owned `0600` at
`configuration/runtime/mariadb/vhostra.cnf`. Docker Desktop cannot read that
file. A dedicated `mariadb-runtime-config` protected operation accepts no
caller path, content, or options. It validates any existing authoritative file
against the fixed ten-setting MariaDB policy (including the section, values,
and absence of extra directives), then atomically writes the private file and
an independently rendered, non-secret runtime file at
`runtime-config/mariadb/vhostra.cnf`. The latter is root-owned `0644`, in
root-owned non-writable-to-others directories, and contains only the approved
settings plus a source hash. The operation rejects links, unsafe ownership or
modes, unexpected existing files, and duplicate destinations. A failure rolls
back completed replacements. No renderer-supplied MariaDB directive reaches
the privileged worker.

In machine layout, Compose mounts only the generated runtime file at
`/etc/mysql/mariadb.conf.d/99-vhostra.cnf:ro`; it has no protected-config mount.
Database preparation compares the generated file with the expected policy and
checks private/public ownership and mode. A missing or outdated generated file
is republished through the bounded transaction; a private file newer than its
runtime copy fails closed. There is no watcher. Policy changes are handled on
database preparation or restart; controlled migration and repair still require
an explicit preparation path. The old root `0600` direct bind is removed from
machine Compose. Database data is not part of config cleanup.

Native validation used one disposable root-owned stage beneath the inactive
`/Library/Application Support/Vhostra` root, which remained explicitly
unselected by production. The protected source verified root-owned `0600` and
unreadable to the ordinary user; the generated file verified root-owned `0644`
with exact expected bytes. Docker accepted the narrow bind, exposed only the
generated file read-only, and a container write to it failed. The inspected
MariaDB image used `mysql` `999:999`. The staged container started, completed
disposable database/table creation, insert and read, and returned
`max_connections=50` from `SHOW GLOBAL VARIABLES`, proving it loaded the
generated file. No staged MariaDB data entry was world-writable. The container
and disposable stage were removed. The production launcher remains separately
validated against isolated staging; production startup still selects the
legacy Store and the machine runtime activation gate remains shut.

For this successful isolated run, the developer personally counted **one**
macOS administrator dialog total: the initial Vhostra staging authorization.
There were **zero** additional authorization dialogs during Docker startup or
ordinary MariaDB SQL. The staging harness invoked Vhostra elevation once and
performed 13 Docker CLI operations, including readiness probes and exact-name
container removal. A read-only process check found no remaining elevated
Vhostra staging or protected worker. No live Store or external website root was
touched. Source tests passed 181/181 and the production build passed.

### Remaining macOS activation gates after MariaDB validation

MariaDB's protected-config bind blocker is resolved in the staged design. It
does **not** establish that the complete machine runtime can start. Machine
Compose still mounts `layout.runtime.openLiteSpeed`, `php`, `apache`, and
`nginx` from `configuration/runtime` directly into the web container. Those
directories contain protected generated web/PHP files, commonly `0600`; the
MariaDB test showed Docker Desktop cannot read such a protected file directly.
An equivalent bounded delivery/permission design and native web-container
validation are required before opening the runtime gate.

The migration copier is a preparation primitive, not the production privileged
migration launcher. It requires an unoccupied destination, while the inactive
Docker-shared `/Library/Application Support/Vhostra` root now exists. A
controlled flow must recognize and safely adopt that exact empty root without
interpreting existence as activation. Copied files are created `0600` without
assigning the service writer identities or directory ACLs needed by MariaDB,
web workers, caches, logs, and runtime state. The staged MariaDB test validated
one disposable ownership model; it did not validate ownership of a migrated
legacy datadir or the complete mixed-service tree. The migration needs a
privileged, verified copy/ownership, rollback and explicit activation-state
transaction while preserving the legacy source and external Site roots.

Production startup still constructs the legacy Store. The native Store
constructor and machine runtime constructor explicitly reject selection of
the fixed macOS system layout. Machine-mode reset and legacy Site
consolidation also fail closed, and runtime replacement recovery has not been
validated for protected web configuration. These are intentional gates that
must be resolved and staged end-to-end before a controlled live activation.
The current answer is **NO** for proceeding to activation; the inactive root
remains unselected and no live migration was performed.

### Web and PHP container configuration delivery (2026-10-06)

The machine-runtime path now uses a separate semantic `web-runtime-config`
operation. The ordinary controller supplies only selected server, PHP version,
HTTPS state and bounded Site identifiers, DNS names, aliases, index names and
rewrite booleans. The elevated worker validates every field, rejects duplicate
names, unexpected keys, path strings and configuration directives, and renders
each server's config itself. Document roots in the generated files are fixed
container paths (`/var/www/html` or `/var/www/vhostra/<verified vhost UUID>`);
the user-selected external website roots remain independent Docker mounts and
are never copied into the machine root.

The worker writes protected authoritative OpenLiteSpeed maps/vhosts/Site
snippets, Apache vhosts, Nginx vhosts, PHP policy and bounded Site logrotate
policy under `configuration/runtime`, root-owned `0600`. It separately renders
only OpenLiteSpeed startup files, PHP policy, and the selected Apache or Nginx
frontend under `runtime-config/web/{openlitespeed,apache,nginx,php}`
as root-owned `0644` files in non-writable-to-others directories. Each public
file carries a digest of its protected source and has no credentials. The
privileged transaction rejects links, unsafe existing files and modes, and
rolls back failed replacements. It removes only obsolete, owned, UUID-named
public OpenLiteSpeed Site snippets and the previously selected frontend file.
Publication happens on explicit runtime
generation, not on a watcher; pre-start checks reject a missing, mismatched or
older public file before Compose starts a machine-layout container. Existing
secret delivery remains separate.

Machine Compose now mounts OpenLiteSpeed startup files, PHP policy and only
the selected Apache or Nginx frontend read-only instead of the protected
configuration directories. The image still chooses
PHP extensions and OPcache from the existing bounded environment settings;
it builds the PHP-FPM pool with `www-data` for Apache/Nginx, while OpenLiteSpeed
uses `nobody`. The PHP runtime file carries only fixed non-secret policy and
the fixed socket path. Site logrotate paths use validated vhost IDs. Managed
Site access/error logs retain mode `0600`.

An isolated native stage beneath the inactive system root published the selected
web files for each server, then started OpenLiteSpeed, Apache and Nginx in separate disposable
containers using only the needed public read-only configuration mounts. Docker mount
inspection found no protected configuration source, and container attempts to
write each public mount failed. Each server returned the disposable Site's PHP
response under its canonical name and alias with the expected generated Site
header; localhost stayed separate. The PHP response confirmed the generated
socket policy and `expose_php=Off`, with LSPHP for OpenLiteSpeed and PHP-FPM for
Apache/Nginx. Container process inspection showed `nobody` for OpenLiteSpeed
and `www-data` for Apache/Nginx; each worker appended to its managed Site log,
which remained `0600` on the host and in the container. The three containers
and stage were removed. No real external Site root or production Store was
touched. Two diagnostic attempts used the wrong PHP error-log expectation for
OpenLiteSpeed's per-Site override; the corrected check passed all three servers.
The final source suite passed 185/185, and the production build passed.
In the final narrowed-mount run, the developer personally observed **three**
macOS administrator/password/Touch ID dialogs total: the initial Vhostra
staging approval and **two additional dialogs** after it during Docker/web/PHP
operation. The harness made **one** Vhostra `osascript` invocation and **30**
Docker CLI operations. The requester of the two additional native dialogs has
not been established because their wording/process was not checked; they must
not be silently attributed to Vhostra or classified as ordinary Docker
informational dialogs. The earlier successful
MariaDB/SQL run remains a separate one-dialog/zero-additional baseline.

#### Docker-only authorization diagnostic (2026-10-06)

Before Gate 2, a single bounded Docker-only image lookup was run as the
ordinary user: `docker image ls` filtered to existing Vhostra runtime images.
It invoked **zero Vhostra privilege mechanisms**, started no container,
changed no Docker setting, and performed no staging or migration. The developer
personally observed **at least two** macOS administrator/password/Touch ID
dialogs during that one lookup. The prior successful web stage also performs
an image listing before starting its server containers and had two additional
dialogs after its one Vhostra authorization. This independently reproduces the
extra-dialog count within the Docker image-query path, without relying on the
wording of the dialogs. The exact macOS helper process behind Docker's request
was not identified. Diagnostics stopped at this smallest reproducing operation;
OpenLiteSpeed, Apache, Nginx, PHP and cleanup were not separately rerun for
prompt attribution. Gate 1's technical PASS remains intact.

This closes the isolated web/PHP Docker-config gate. The **activation answer
remains NO** because the full machine migration still needs a privileged,
explicit activation/rollback transaction, safe adoption of the already-empty
Docker-shared root, ownership and ACL setup for migrated MariaDB/runtime/cache/
log data, and end-to-end validation of that migrated layout. Native Store and
runtime machine-layout guards remain in place; production still uses legacy
storage.

### Gate 2 synthetic migration and rollback (2026-10-06)

The Gate 2 migrator now accepts a fixed-shape request with separate legacy
source, inactive machine root, source owner and inspected MariaDB writer
identity. It validates source records and paths, inventories only managed
storage, rejects links and special files, then copies into one attempt-specific
payload under the inactive root. No source data is removed. External Site roots
are inspected only as exclusion boundaries and are not copied.

The journal moves through `preparing → copied → verified →
ready-for-activation`. Failed attempts record `rolled-back`; a new attempt can
follow that result. Crash recovery rolls back unfinished stages and re-verifies
a ready stage against the legacy source before returning readiness. `active`
is reserved for Gate 3; this module provides no activation commit and startup
continues to reject the native machine Store. An empty root or a ready journal
cannot select machine storage.

Ownership is assigned by path purpose. Protected configuration, settings,
Site metadata, certificates/private and service metadata are root-owned and
private. Generated container runtime configuration is in `runtime-config`,
root-owned and readable only where the selected containers need it. MariaDB,
Redis, Memcached, web/PHP state and logs use the inspected service writer
`999:999`; MariaDB data is `0700` directories and `0600` files, and Site logs
are `0600`. Public built-in Site content and public certificates use readable
files. Exact copied and generated inventories, source hashes/byte counts,
owners, groups and modes are checked before readiness.

The focused source tests cover a successful migration, five injected failures,
interrupted preactivation recovery, a retry after rollback, links and occupied
roots. A bundled, short-lived native worker accepts only a synthetic
`/private/tmp/vhostra-gate2-native-…/legacy/Vhostra` fixture and uses a single
macOS authorization request. Its first run passed source preservation,
external-root preservation, `999:999` MariaDB data, protected/generated
configuration separation, `0600` Site logs, six failure paths and helper exit;
the developer observed zero macOS dialogs during that run despite one Vhostra
privilege invocation. The final rerun after recovery and HTTPS-model tightening
also passed with one Vhostra privilege invocation and one administrator dialog
personally counted. No real legacy Store or external website root was touched;
the inactive machine root was empty afterward. Docker was not used. The full
source suite passed 194/194 and the production build passed.
