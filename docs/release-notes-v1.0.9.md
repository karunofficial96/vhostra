# Vhostra v1.0.9 — draft release notes

**Draft for release preparation.** These notes do not announce a tag or published release.

## Startup and recovery

- Choose **Manual**, **Run Services When Vhostra Opens**, or **Run Services on Login**. Login service startup runs in the background without opening the Vhostra window. **Launch Vhostra on Login** is available when a compatible startup mode is selected.
- Automatic startup retries while Docker Engine becomes ready and recovers after temporary Docker interruptions. It starts missing enabled services without restarting services that are already running.
- MariaDB startup waits for actual readiness and health. The app reports starting, unhealthy, stopped, and failed states more accurately and records clearer diagnostics when startup fails.
- Platform-specific login and shutdown handling keeps the existing Vhostra runtime and data ownership boundaries.

## Upgrade and data

The application identifier, installer identity, Docker Compose project names, data locations, and existing profile settings remain the same. The stable installer is intended to upgrade the existing installation while preserving Sites, document roots, MariaDB data, certificates, backups, and settings. As with any upgrade, retain a current backup before replacing the installed application.

## Verification and limitations

- The release owner physically tested startup modes, Docker service startup, and MariaDB recovery on **macOS ARM64**.
- At beta commit `7cd2110`, the automated suite passed **160/160** tests. The [beta packaging run](https://github.com/karunofficial96/vhostra/actions/runs/39461125938) passed six native packaging jobs and its aggregate verification job, including the ten-installer matrix and checksum checks. Windows and Linux installer results are CI packaging checks, not physical installation tests. Stable-version packages require their own verification run before publication.
- Windows and Linux login and shutdown behavior has **not** been physically verified. Physical Windows/Linux installation and runtime behavior remain open acceptance items.
- macOS remains **ad hoc signed**. It is **not Apple Developer ID signed or Apple-notarized**. Apple has not certified or notarized Vhostra.
