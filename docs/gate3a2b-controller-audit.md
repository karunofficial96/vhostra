# Gate 3A.2b production runtime-controller mutation audit — 2026-10-07

Scope: `DockerRuntimeController` in `electron/runtime.ts`, its generated
Compose files, and `runtime-image/entrypoint.sh`. This is an audit of the
**actual** controller path, not the isolated Gate 3A.2 service fixtures.
The constructor still rejects every `StoreLayout` with `userRoot`; no real
machine-layout controller or Store was started.

| Lifecycle and mutation | Current writer/path | Required machine boundary | Status |
| --- | --- | --- | --- |
| `start` / `restart`: validate Site roots, Docker and ports | ordinary process reads Site paths; Docker queries | read-only validation, bounded timeouts | no host mutation |
| `generate`: create runtime root and service subdirectories | ordinary process in `data/runtime` | user-private coordinator workspace for Compose/image, service-private persistent data elsewhere | **blocked**: Gate 2's machine `runtime` tree is service-owned |
| `ensureEnvironment`: create `secrets.env`, root password, phpMyAdmin password and blowfish secret; copy PMA values to `.env` | ordinary process under `runtime/mariadb` and `runtime` | persistent secret publisher, secure approved-client access, narrow Docker delivery | **blocked**: root-private secrets cannot be read by the current ordinary controller; no signed Gate 3A.1 read service |
| `prepareDatabase`: create datadir/log dir; read upgrade marker; copy MariaDB build context; write root-password file and Compose | ordinary process in `data/mariadb`, `logs/mariadb`, `runtime/mariadb` | mysql owns datadir/logs; transient build context separate; protected secret delivery | **blocked**: direct mkdir/read/write of mysql-owned and protected paths |
| `generate`: write four built-in PHP health files | ordinary process in `service-data/localhost/public` | immutable image resource or bounded built-in publisher, never overwrite user content | **blocked**: repeated ordinary protected write |
| `generate`: create/chmod Site log directories/files | legacy ordinary process under `logs/sites` | container entrypoint exact Site-ID creation, worker-owned `0700/0600` | machine branch already skips; isolated recreation passed |
| `generate`: Redis/Memcached configuration | legacy ordinary process in `runtime/{redis,memcached}` | semantic `cache-runtime-config` publication, read-only projection | machine branch implemented; isolated recreation passed |
| `writeServerConfiguration`: web/PHP authoritative and projected configuration | legacy ordinary process; machine protected transaction | semantic generated-config publication, selected read-only binds | machine branch implemented; isolated recreation passed |
| `generate`: copy runtime image, hash build inputs, write web Compose | ordinary process in `data/runtime` | user-private, collision-safe coordinator workspace; immutable image inputs | **blocked**: machine workspace is mixed-owner and shared by accounts |
| `upCompatibleImage`, `startDatabase`, `stop`, service control | Docker writes container layers, networks and selected service bind mounts | exact managed labels, service-owned data; no ordinary datadir writes | isolated services passed; actual machine controller untested |
| `provisionPhpMyAdmin`: read secret, execute SQL, write hash marker | ordinary process in `runtime/mariadb` | secure secret access, SQL through authorized service, durable idempotent marker | **blocked**: protected secret/marker sharing unresolved |
| `start`: write `healthy-state.json` | ordinary process in `data/runtime` | durable coordinator state with generation and recovery protocol | **blocked**: current file duplicates selected settings and is not a protected activation record |
| `restart`: create recovery dir/manifest, copy runtime/generated/Sites/built-in, create candidate work/log/certificate trees | ordinary process in per-user `backups` plus mixed machine paths | per-user transient candidate workspace; protected snapshots only via semantic publisher/read service; no copying authoritative secret trees | **blocked**: current recursive copy assumes read/write access to protected machine state |
| `restart`: promote, restore copies after failure, delete candidate/backup and image tags | ordinary process and Docker | generation-based publication/rollback with one authoritative state, exact cleanup | **blocked**: current rollback recursively copies over machine workspace |
| backup cache state/restore, SQL export/import | ordinary process and Docker, selected user file | cache policy semantic state; chosen user export location | machine cache restore still directly writes legacy config path; must be rerouted |
| certificate creation/renewal during web start | container root in whole authoritative certificate bind | bounded host publisher; read-only container consumer | machine Compose now selects `:ro` and `external`; publisher not implemented |
| built-in phpMyAdmin setup, server work, sockets/PIDs, Redis/Memcached memory | container root or worker in built-in bind/container layer | container-local transient state; only explicitly persistent data on host | isolated lifecycle passed; built-in bind remains writable |
| cleanup and reset | ordinary process/Docker remove exact owned resources; Store reset has separate writes | no deletion of external Sites or mysql data without explicit reset | actual machine reset/recovery untested |

`execute` and Compose operations have bounded timeouts (usually 60–120 seconds;
build/up can take 15 minutes). MariaDB/HTTP readiness has separate bounded
loops. No new listener, telemetry or background poller was introduced here.

## Secret and certificate dependency

The current controller reads the entire `secrets.env` on startup, extracts
the MariaDB root password, creates a second PMA `.env`, and later reads that
file again to provision the SQL account. Making those files root-private
without changing the access protocol breaks both first and fresh-controller
initialization. Making them ordinary-user writable or broadly readable would
violate the matrix. Gate 3A.1's approved signed privileged read service is
the planned secure route for protected shared values. Gate 3A.2b must not
imitate it with an unsigned helper, generic privileged read, or copied
world-readable secrets. Secret generation also needs an idempotent semantic
transaction and interruption test; neither exists yet.

The machine Compose now mounts the certificate tree read-only and instructs
the entrypoint to require an externally published, current certificate/key
pair and matching names. It refuses to generate or renew keys in that mode.
The legacy Compose remains `managed`. There is no machine certificate
publisher yet, so the future machine runtime still cannot start with TLS.
Private-key sentinel preservation and container mount behavior still need
native controller validation.

## Stop point

The real machine guard remains enabled. Removing it or constructing a test
machine controller now would exercise direct ordinary writes to service-owned
MariaDB data, protected/shared secrets, built-in content and recovery paths.
An actual production-controller synthetic machine lifecycle is therefore
unsafe and has not been claimed. The writer split and secure secret-access
protocol must be completed before a staging-only controller injection point
or native controller run is appropriate. Gate 3A.1 remains **DESIGN COMPLETE /
IMPLEMENTATION BLOCKED ON APPLE SIGNING**.
