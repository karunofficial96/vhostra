# Gate 3A.2b remaining writer boundaries — 2026-10-07

The native machine Store and runtime guards remain closed. This pass used
source and disposable filesystem fixtures only. No native authorization, real
Site, database, certificate, legacy Store or inactive machine root was touched.

## Database secrets

| Value | Purpose | Legacy consumer | Required machine boundary |
| --- | --- | --- | --- |
| `MARIADB_ROOT_PASSWORD` | first database bootstrap | exact `root-password` Docker secret projection; MariaDB entrypoint reads it | root-private authority and bounded MariaDB-only bootstrap delivery |
| `VHOSTRA_PMA_PASSWORD` | SQL account provisioning and phpMyAdmin config authentication | SQL over stdin and explicit web-container environment | protected SQL provisioning and narrow web delivery, without returning plaintext to Electron |
| `VHOSTRA_PMA_BLOWFISH_SECRET` | phpMyAdmin cookie encryption | explicit web-container environment | narrow web delivery |

Legacy web and database Compose now use **one canonical**
`runtime/mariadb/secrets.env`. The web controller no longer writes a second
`runtime/.env`. A known mode-`0600` legacy `.env` can seed first use; conflicting
or malformed duplicates fail closed, and a matching duplicate is removed.
The served phpMyAdmin PHP source reads its password from the container
environment rather than persisting a plaintext copy. The legacy
`root-password` projection remains necessary for the current MariaDB bootstrap
mount; a mismatch with canonical secrets now fails before Compose publication.

The machine controller cannot read the root-private canonical file or pass it
to an ordinary Docker CLI. Gate 3A.1's signed, approved-client service must
provide fixed semantic operations: ensure credentials, prepare exact MariaDB
bootstrap delivery, provision the phpMyAdmin SQL account, and deliver only
the two needed values to the selected web container. No operation may return
plaintext to Electron, accept an arbitrary path, or expose a generic
privileged read. It must validate caller identity/enrollment and implement
idempotent generation and interruption recovery. None exists yet; machine
methods now fail before secret consumption.

## MariaDB and built-in writers

Persistent `data/mariadb` belongs to the validated `mysql` identity `999:999`.
Legacy `prepareDatabase` creates the datadir/log directories, reads its series
marker and builds Compose/image files in `runtime/mariadb`. The machine method
now refuses before any of those operations. A shared service coordinator must
separate disposable Compose/image work from the service-owned datadir, obtain
series metadata through a bounded operation/container probe, and prevent two
approved users from starting competing projects on the same data. Synthetic
Gate 3A.2 container recreation already showed SQL persistence; the guarded
production controller has not run that lifecycle.

The built-in localhost welcome/assets and phpMyAdmin are Vhostra content;
external Site document roots are user content. Legacy Store and runtime write
only their managed localhost root, but the machine Store/runtime now refuse
those writes. Machine Compose specifies a read-only built-in mount. A bounded
built-in publisher or container-local immutable resource layer is still
needed. The phpMyAdmin entrypoint still copies bundled resources into the
legacy writable mount and cannot run against the machine read-only mount.
External Site roots were neither copied nor changed in this pass.

## Recovery ownership

| Current legacy item | Future machine disposition |
| --- | --- |
| `runtime/healthy-state.json`, a full settings/Sites duplicate | replace with one generation-tagged success marker; protected Store remains authoritative |
| per-user `backups/runtime-recovery-*/recovery.json` | per-user transient diagnostic only, never authority over shared configuration |
| recursive runtime/generated/Sites/built-in/certificate copies | forbidden across protected and service-owned trees; use protected generation and exact read-only projections |
| candidate Compose/image/logs | separate coordinator workspace with exact resource ownership/cleanup |
| copied secret/certificate material | never enter per-user recovery; protected publisher retains current and previous generation until commit/rollback |

Machine `restart` now refuses before journal or copy creation. Legacy recovery
is unchanged. Machine recovery still needs one protected prepare/verify/commit
record and interruption recovery that selects the last verified generation.

## Certificate publisher stop point

The read-only consumer passed disposable key/certificate/SAN/link tests.
Publication waits for the preceding secret, coordinator, built-in and recovery
boundaries. A fixed publisher request should take validated DNS/IP names and
a generation precondition, never paths or shell fragments. It must stage
bounded PEM under a root-private directory, verify key/certificate match and
SAN coverage, reject linked inputs, atomically switch a durable generation,
retain the prior generation for rollback, and expose only exact read-only
container mounts. Private keys cannot enter per-user recovery or renderer
responses. Signed caller authorization and shared Docker/recovery coordination
depend on the unavailable Gate 3A.1 service. No publisher was attempted.
