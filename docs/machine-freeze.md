# macOS machine architecture freeze — 2026-10-07

macOS secure machine-wide storage/runtime architecture is intentionally
disabled pending a signed privileged service with authenticated XPC client
validation. Production continues using the legacy per-user Store and runtime.
Do not bypass the guards, substitute ad-hoc signing, or weaken filesystem
permissions.

No Apple Developer / Developer ID signing identity is currently available.
The Gate 1, Gate 2 and Gate 3A implementation, synthetic tests and design
records are retained for later continuation. This freeze does not install a
LaunchDaemon/XPC helper, activate a machine Store, migrate existing users or
add a user-facing experimental switch. Normal legacy development remains
available. The machine Store/runtime constructor guards and unavailable
production coordinator are deliberate acceptance boundaries, not prompts to
show ordinary users.

For architecture and evidence, see `gate3a1-macos-read-service-preflight.md`,
`gate3a2b-writer-boundaries.md`, `gate3a2c-coordinator-recovery.md`,
`gate3a2d-generation-consumption.md`, and `VHOSTRA_EXECUTION_STATE.md`.
Before any future activation, implement and verify the signed service,
authenticated client identity, protected secret delivery, service-owned
MariaDB preparation, generation commit/recovery and certificate publication.
Then run an explicit native activation review. Directory existence and
migration-ready state grant no activation authority.
