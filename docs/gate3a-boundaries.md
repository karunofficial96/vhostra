# Gate 3A boundary decision — 2026-10-07

**Historical machine-wide design.** The supported macOS architecture is now
the [per-user runtime](macos-supported-architecture.md). This proposed helper
is not a runtime prerequisite or active product plan; see the
[machine-wide freeze](machine-freeze.md).

Gate 3A stops before activation. The Gate 1 and Gate 2 staging results remain
valid, but the ordinary production process cannot use Gate 2's root-private
machine Store as implemented. The current `osascript` worker is short-lived and
handles bounded writes. It has no protected read method. Starting a new
administrator shell for each Store read would make ordinary startup, Site
listing, and refresh dependent on interactive authorization. Credential cache
behavior cannot guarantee prompt-free routine reads.

Apple distinguishes a systemwide root LaunchDaemon from a per-user LaunchAgent
or ordinary bundled XPC service. The latter is not a root helper. macOS 13+
supports registering a bundled LaunchDaemon with `SMAppService`, subject to
user approval. A privileged Mach/XPC service can be started on demand and
managed by `launchd`. The intended implementation is a **small, separately
signed, on-demand daemon**, not a permanently running Electron process or a
general root filesystem server. It must be designed and reviewed before
installation. This decision depends on a real signing identity and installer
flow; the current ad hoc signed development bundle is not sufficient evidence
for a production code-signing trust policy.

## Proposed helper boundary

The main process would connect to a fixed Mach service. The helper would accept
only a matching signed Vhostra client and verify the connection's effective
user identity. An approved-user registry, owned by root, would contain exact
local UIDs enrolled through an explicit administrator-authorized operation.
No renderer IPC method would accept a path or expose the helper connection.
An unknown or unenrolled user gets a bounded error, not an authorization loop.

The read interface should have semantic requests only:

| Request | Fixed source | Returned data | Limits |
| --- | --- | --- | --- |
| `readSharedSettings` | active machine `settings.json` | validated shared settings without another user's startup preference | single regular file, size cap, strict schema |
| `listSites` / `readSite(id)` | active machine `sites/*.json` | validated Site and canonical virtual-host fields | UUID or built-in ID only, bounded record count and bytes |
| `readOnboardingEnvironment` | active machine `onboarding.json` | shared completion/runtime fields; per-user theme stays in user data | single regular file, strict schema |
| `readActivationState` | fixed machine activation marker | phase, attempt ID, verified active layout identity | no caller path, exact version and owner |
| `readServiceMetadata` | individually allowlisted state files | only service status/recovery fields needed by main | no secrets, bounded values |

Every read must use fixed roots, validated relative names, `openat`-style
directory-relative opens where available, no-follow semantics, regular-file
and link-count checks, owner/mode checks, size limits before allocation, and
strict record validation before returning data. The helper must never accept
`readFileAsRoot(path)` or return private keys, MariaDB credentials, bootstrap
secrets, raw Compose environment files, arbitrary logs, or unrelated protected
files. Its output goes only to the authenticated main process, which exposes
the existing minimal renderer state projection. Writes need their own semantic
operations and concurrency checks; read authorization does not imply write
authorization.

Registration must be explicit after user review. The app checks the service's
status at startup and fails closed when it is unavailable. The helper is
on-demand, stateless between requests where possible, idle-exiting, and has no
polling loop. Upgrades replace its signed bundle through the supported service
registration flow. Uninstall unregisters it and verifies it is no longer
available, while leaving machine data untouched until a separate user-approved
data removal. A failed or revoked service must not make production silently
select the legacy Store after machine writes have begun.

## Writer and mode matrix

Modes below are the intended boundaries, not an instruction to change the
current root. Numeric container identities must be verified against the exact
images before applying them. `root-private` means protected from the ordinary
app and Docker bind mounts; approved users read validated projections through
the proposed helper.

| Path/purpose | Legitimate writer | Intended owner/mode | Current Gate 3A finding |
| --- | --- | --- | --- |
| Migration/activation journal and marker | bounded privileged migration transaction | root, `0700` parent and `0600` files | Gate 2 has ready journal; no active commit |
| Authoritative settings, onboarding environment, Site/virtual-host records | bounded privileged Store transaction | root-private directories `0700`, records `0600` | correct protection; ordinary Store direct reads fail |
| Authoritative web/MariaDB configuration | bounded privileged generator | root-private `0700`/`0600` | Gate 1 boundary passed; no Docker mount |
| Private keys and bootstrap secrets | bounded privileged creator; container root only where required | root-private `0700`/`0600` | never returned by shared read API |
| Generated Docker runtime configuration | bounded generated-config publication | root-owned directories `0755`, non-secret files `0644`, read-only mounts | separated and validated in Gate 1/2 |
| MariaDB persistent data | inspected MariaDB container `mysql` writer | `999:999`, directories `0700`, files `0600`; no world write | Gate 2 verified; ordinary app must not mutate |
| MariaDB Compose/image working set | Vhostra runtime coordinator; secret publication through bounded helper | separate controlled working area; secrets `0600` | currently under service-owned `runtime/mariadb`; ordinary app cannot prepare/recreate it |
| Built-in Site document root and health/welcome files | selected web/PHP container or bounded publisher | separate from protected config; exact service/app writer policy required | current ordinary `generate` and welcome code write service-owned content |
| Site access/error logs | OLS `nobody` or Apache/Nginx `www-data` container worker | per-Site directories `0700`, files `0600`; protected parent traversal | container entrypoint switches owner by server; Gate 2's initial `999` owner is not the final web writer |
| General web/PHP logs | selected container worker/root master | service-specific narrow owner/group, non-world-write | ordinary runtime must not chmod or create under service-owned log root |
| Redis configuration | bounded generator, read-only container mount | separate non-secret generated file `0644` | Gate 3A.2 adds fixed generated projection; machine runtime lifecycle remains guarded |
| Redis persistent data, if enabled | verified Redis container identity | dedicated `0700` directory and `0600` files | current Redis policy disables AOF and snapshots; persistence and UID need explicit design/test |
| Memcached configuration/state | bounded generator; ephemeral container state | non-secret read-only config; no persistent host data by default | Gate 3A.2 adds fixed generated projection; machine runtime lifecycle remains guarded |
| Transient Compose/image/PID/socket/build artifacts | runtime coordinator or container as appropriate | per-purpose app-owned or service-owned workspace; never under protected config | current shared `runtime` subtree has one `999:999` policy for unlike writers |
| Per-user theme, onboarding completion, startup preference, screenshots/backups | that OS account's ordinary Vhostra process | user-private `0700` directories and `0600` files | already separate from machine environment; must stay separate |

The runtime refactor must move every ordinary `generate`, `prepareDatabase`,
cache configuration, health-file, log-directory and recovery mutation onto
its legitimate writer side. It must preserve the tested MariaDB bind and
protected/generated configuration split. A second approved user needs the
same shared Site and service view without access to another user's private UI
files or repeated administrator prompts. The Docker service coordination and
cross-user access policy must be validated before activation.

The full path-by-path writer/read/mount/backup classification and the current
Gate 3A.2 implementation gaps are tracked in
[gate3a2-runtime-writers.md](gate3a2-runtime-writers.md).

## Gate 3A acceptance still required

After the helper design and signing/registration decision, implement and test
semantic reads, arbitrary-path/traversal/link/oversize/malformed/secret
rejection, exact caller authorization, multi-user separation, no-prompt routine
reads, and the service-specific runtime ownership paths. Run native tests only
against disposable fixtures. Keep the Store/runtime activation guards until
those checks pass. No activation or real migration is authorized by this note.

Apple references: [Authorization Services](https://developer.apple.com/documentation/security/authorization-services),
[SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice),
[XPC service types](https://developer.apple.com/documentation/xpc),
[XPC code-signing requirement](https://developer.apple.com/documentation/foundation/nsxpclistener/setconnectioncodesigningrequirement(_:)).
