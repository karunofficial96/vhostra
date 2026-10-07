# Gate 3A.1 macOS protected-read service preflight — 2026-10-07

**Decision: stop before implementing or registering a privileged service.**
The current checkout and Mac cannot securely validate the required signed
client identity. `security find-identity -v -p codesigning` found **0 valid
identities**. The macOS release workflow sets
`CSC_IDENTITY_AUTO_DISCOVERY: 'false'`, and the package has no helper target,
LaunchDaemon property list, entitlements, Developer ID signing, hardened-runtime
or notarization step. The only local packaged-app fixture is deliberately
ad-hoc signed and states that it is not a release-signing workflow. Apple says
an ad-hoc signature has no signing identity; a requirement restricting the
signing identity fails. Pinning a mutable development binary by path, PID,
bundle name or `cdhash`, or accepting any local client, would not validate the
production caller across builds and upgrades. We will not use those substitutes
for a root service that reads private records.

This is a **prerequisite**, not a test failure of a service. No helper code,
registration, administrative enrollment, XPC connection, native fixture, or
protected read was run. Gate 1/2 results stand, and the native Store/runtime
guards remain enabled. macOS 13 or later is required for the proposed
`SMAppService` route; Vhostra's minimum macOS version and fallback policy must
be set explicitly before shipping. This Mac has macOS 27.0 and Xcode, but no
valid code-signing identity.

## Shippable packaging and trust requirements

1. Obtain an Apple development identity for a signed native development app
   and helper, then a Developer ID Application identity for direct distribution.
   Configure the Electron app and nested native client/daemon signing as a
   single team. Sign nested code inside-out, use hardened runtime, verify the
   finished app and helper signatures, then notarize the distributable package.
   A signed app placed in a stable, protected installation location must be
   exercised; `electron .` and the temporary ad-hoc performance bundle are
   not proof of this identity model.
2. Bundle the daemon executable with the app and its plist in
   `Contents/Library/LaunchDaemons`, using `BundleProgram` and one fixed Mach
   service name. Register with `SMAppService.daemon(plistName:)`. Registration
   is not approval: an administrator must approve the LaunchDaemon in System
   Settings before macOS bootstraps it. Show explicit pending/denied/enabled
   states and fail closed when unavailable. Never copy a plist into global
   LaunchDaemons behind the user's back.
3. Use a small signed native bridge callable only by Electron main, or a
   separately signed main-process native module, to open the privileged Mach
   service. No renderer XPC access. A stock, unbundled CLI or generic Node
   process must not satisfy the daemon's client requirement. Decide the exact
   bridge executable and bundle identifier before deriving its designated
   requirement from the signed artifact.
4. On **both** ends, constrain the XPC peer to the expected Apple-issued team
   and exact Vhostra executable identifier; verify the running peer rather
   than trusting a caller-supplied identifier. Do not use identifier alone,
   development `get-task-allow` in a shipping build, path, PID alone, or a
   generic same-team rule. Enforce a versioned protocol and reject unknown
   versions. Recheck peer validity across reconnection. Confirm the chosen
   requirement against a real signed development build and the Developer ID
   build; production must fail closed if the requirement cannot be evaluated.
5. The installer/updater must preserve app-bundle immutability and avoid a
   mismatched app/helper pair. Stage and verify the new signed bundle before
   replacement; test service status, protocol compatibility and rollback on a
   failed replacement. Do not infer that `register()` itself completes admin
   approval, and do not silently reauthorize on each normal launch. Uninstall
   unregisters the helper and verifies service removal separately from data
   deletion; it preserves Sites and databases by default and never recursively
   deletes `/Library/Application Support/Vhostra` as a helper cleanup step.

## Meaning of an approved Vhostra user

An approved user is a **specific local OS account explicitly enrolled by a
local administrator** for shared-environment reads. Being logged in, knowing
the service name, sharing a Unix group, or possessing a Vhostra copy does not
grant access. Initial administrator setup explicitly enrolls the first
account; each later account needs a separate admin-authorized enrollment.
Revocation is an equally explicit admin operation. Neither ordinary UI reads
nor reconnects may trigger authorization. No password or reusable
administrator credential is stored.

The daemon stores a root-owned, private registry containing each enrolled
account's stable directory-services identity (GeneratedUID) plus its current
numeric UID. On each connection it obtains the effective UID from the XPC
peer, resolves that UID to the current local account, and requires both the
stable identity and UID to match the registry. This rejects UID reuse after
account deletion and stale enrollment. Enrollment/revocation must be a
separately allowlisted, administrator-authorized transaction; it cannot be
sent through the read protocol. Registry writes must be atomic, owner/mode
checked (`root:wheel`, private directory `0700`, regular file `0600`), and
symlink resistant. All connections must be rejected immediately after
revocation; no long-lived per-user capability token is issued. Handling
directory-services outages must fail closed. The exact account-lookup API and
fast-user-switching behavior need signed native tests before deployment.

## Proposed protocol and file checks

The native daemon exposes distinct, versioned methods: validated shared
settings; bounded Site summaries; one validated Site by a strict canonical
Site ID; limited service metadata; and migration/activation status. The daemon
chooses every fixed machine path itself. It does not accept a caller path,
directory name, glob, command, shell fragment, environment variable, or
arbitrary operation string. The renderer receives only the existing bounded
main-process UI projection. Main/preload IPC must be an explicit method list,
with schema checks, and cannot forward arbitrary XPC messages.

Each handler verifies signed peer **and** enrolled local account, schema and
operation version, active-state selection, root/parent owner and mode, regular
file type and link count, size before allocation, and record schema before
returning fields. Directory-relative no-follow opens prevent symlink/traversal
escape; compare the opened file's metadata with expected root-private policy.
Site IDs must be canonical UUIDs or explicitly listed built-in IDs, never
path-like text. Cap Site count and total response bytes. Unknown or malformed
records fail closed rather than leaking raw JSON. Return typed minimal data,
never raw protected-file bytes. Private keys, MariaDB credentials, bootstrap
secrets, updater tokens, environment files, unrelated files, and raw logs have
no protocol method and are never copied to a per-user cache.

The service has no network listener, polling, scanner or telemetry. The Mach
service is demand-started by `launchd`; Vhostra must explicitly close idle
connections and arrange bounded idle process exit. Do not assume that all
LaunchDaemons automatically stop at the same idle interval. Keep no
privileged Electron process. Loss of service returns a bounded error; after
machine activation it must not silently fall back to the legacy Store.

## Tests required once signing exists

Use only synthetic private fixtures. Test approved settings/list/record reads,
unapproved and revoked users, UID reuse, unknown protocol versions and methods,
malformed/path-like Site IDs, traversal, symlink and hard-link attempts,
oversized and malformed JSON, wrong owner/mode, secret/private-key/database
credential denial, renderer path injection, helper/client identity mismatch,
zero administrator prompts on repeated approved reads, idle exit, registration
pending/denied/approved, failed update, rollback and uninstall preserving data.
Test both signed development and Developer ID distribution artifacts. None of
these privileged-service behaviors can honestly be marked PASS today.

Sources: [SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice),
[registration approval](https://developer.apple.com/documentation/servicemanagement/smappservice/register%28%29),
[bundled daemon layout](https://developer.apple.com/documentation/servicemanagement/updating-helper-executables-from-earlier-versions-of-macos),
[XPC service types](https://developer.apple.com/documentation/xpc),
[XPC peer signing requirements](https://developer.apple.com/documentation/foundation/nsxpclistener/setconnectioncodesigningrequirement%28_%3A%29),
[code-signing requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements),
[ad-hoc identity limitation](https://developer.apple.com/documentation/security/seccodesignatureflags/adhoc),
[Developer ID and notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).
