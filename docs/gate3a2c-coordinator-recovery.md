# Gate 3A.2c coordinator and generation staging — 2026-10-07

This is a contract and synthetic staging pass. The production machine-runtime
constructor guard remains closed; the production Store remains legacy. No
signed privileged service, native authorization or machine activation exists.

## Coordinator contract

`electron/machine-coordinator-contract.ts` defines one versioned, exact-field
semantic request union:

| Operation | Future privileged responsibility |
| --- | --- |
| `ensure-database-credentials` | create/retain canonical root-private credentials without returning plaintext |
| `prepare-mariadb-storage` | use only fixed Vhostra data/log locations and verified `mysql` identity; reject incompatible server series |
| `prepare-mariadb-bootstrap` | deliver root initialization secret only to MariaDB |
| `provision-phpmyadmin` | use PMA password inside protected SQL provisioning |
| `prepare-web-secret-delivery` | deliver only PMA password/blowfish secret to selected web generation |
| `publish-built-in` | publish packaged Vhostra content for one generation |
| `publish-authoritative-generation` | select one verified generation with a revision precondition |
| `publish-local-certificate` | publish requested DNS/IP identity for one generation |

Requests cannot contain paths, arbitrary file content, commands, environment
files, PEM bytes, passwords or generic filesystem verbs. Certificate names are
bounded, valid and duplicate-free, and require localhost and 127.0.0.1. The
future signed service must additionally verify the peer's signature and
enrollment, fixed roots, service identities, authorization and no-follow file
operations. The contract grants no privilege by itself. Production
`DockerRuntimeController.machineCoordinator()` calls an unavailable factory
that always throws; there is no synthetic backend injection route.

## Built-in publication

`electron/builtin-publisher.ts` is a trusted-backend primitive for that future
service. It accepts fixed system roots at construction, a trusted in-memory
packaged bundle, a validated semantic model, a content version and a
generation ID. It writes only allowlisted welcome/assets and four health files
under `service-data/localhost/generations/<id>/public`; the request cannot
select a destination. It bounds file count/bytes, checks links and existing
file hashes, and writes a per-generation manifest. Identical repeated
publication is a no-op; altered content for the same generation or a foreign
file fails. A new candidate goes beside the previous generation. External
Site document roots are neither inputs nor destinations.

This primitive is **not connected** to production Store/runtime. Gate 3A.2d
added a synthetic committed-generation Compose selector and a container-local
phpMyAdmin resource/config layer; see `gate3a2d-generation-consumption.md`.
Packaged bundle loading,
privileged ownership checks and native lifecycle validation remain open. A
bounded loader now reads the actual packaged `dist-welcome` tree, rejecting
links, unexpected names, oversized files and excess file count; the signed
service must select that immutable bundle location.

## Generation recovery

`electron/machine-generation.ts` defines a strict secret-free ledger and an
atomic compare-and-swap storage interface. States are `preparing`, `verified`,
`committed`, `retired`, and `failed`. Only verified work can commit. A commit
retires the old entry and moves the sole committed pointer in one CAS update.
Fresh controllers ignore incomplete candidates. Failed preparation retains
the last commit. Cleanup preserves the committed entry and pending work and
removes only retired/failed metadata. Extra fields, including secrets, are
rejected. A pure selector derives the fixed built-in projection path only
from the validated committed ID. Synthetic tests cover these transitions and
a fresh controller.

The production protected CAS store does not yet exist. Gate 3A.2d added a
synthetic fixed-root file store, file/directory sync and bounded physical
cleanup, with the durability limits recorded in its own document. Legacy
`healthy-state.json` and recursive recovery copies remain on
the legacy-only path; machine `restart` refuses before using them. The future
service must persist CAS, map the committed ID to exact content/configuration/
certificate projections, preserve physical known-good generations through
health verification, and clean physical resources only after proving they are
not the sole valid generation. Synthetic ledger tests do not prove native
durability or production recovery.

## Certificate publication

`publish-local-certificate` has no destination or PEM field. The future
trusted service must stage bounded key/certificate material under a fixed
root-private generation path, verify key match, SAN and requested DNS/IP
coverage, reject symbolic/hard links, atomically publish after verification,
and expose only exact read-only container mounts. The existing consumer stays
fail-closed. Publisher implementation depends on the signed service and
generation integration; no certificate was generated or installed.
