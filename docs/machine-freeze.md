# Dormant macOS machine-wide architecture — 2026-10-07

Vhostra's supported macOS architecture is the per-user Store and runtime
described in [macOS architecture](macos-supported-architecture.md). It does
not require a paid Apple Developer / Developer ID membership or the proposed
signed privileged machine service for normal operation. Distribution signing
and notarization are separate packaging and trust questions.

The machine-wide macOS Store/runtime is **not part of the supported product
architecture**. It remains disabled indefinitely. Do not activate it from
directory existence, migration-ready state, Settings, Welcome, CLI, or an
environment variable. Do not migrate existing users silently. Do not bypass
the Store/runtime guards, substitute ad-hoc signing for privileged-service
client validation, or weaken filesystem permissions.

Gate 1, Gate 2, and Gate 3A code, tests, and documents are retained as
engineering history. They do not create a roadmap commitment or a requirement
that users buy an Apple Developer membership. Resuming machine-wide work
requires an **explicit future architecture decision** and a separately
reviewed privileged-service trust model; it is not the next automatic Gate.
No LaunchDaemon/XPC helper is installed or registered by normal Vhostra.

Historical design and evidence remain in
[Gate 3A.1 preflight](gate3a1-macos-read-service-preflight.md),
[Gate 3A.2b writer boundaries](gate3a2b-writer-boundaries.md),
[Gate 3A.2c coordinator recovery](gate3a2c-coordinator-recovery.md),
[Gate 3A.2d generation consumption](gate3a2d-generation-consumption.md),
and [execution state](../VHOSTRA_EXECUTION_STATE.md).
