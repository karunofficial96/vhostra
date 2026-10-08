# Vhostra v1.0.8 — draft release notes

**Preparation only.** These notes do not announce a tag or published release.

## Installer changes

- macOS packages now ad hoc sign the complete Vhostra app and nested Electron frameworks. This corrects the invalid or missing bundle signatures found in the v1.0.7 DMGs; the disk images themselves were intact.
- The release workflow verifies DMG integrity, architecture, executable permissions, the app bundle and nested signatures, plus the packaged CLI. It assembles exactly ten packages, generates `SHA256SUMS` and a release manifest from their bytes, and checks the checksum file.
- Windows installer verification covers x64 and ARM64 installation, installed executable architecture, CLI launch, user PATH ownership, reinstall, uninstall, and preservation of a Vhostra user-data fixture. Linux checks cover both CPU architectures, package dependencies and desktop files, DEB install/removal, and AppImage CLI execution.

## Security and data

The macOS apps are **not Apple Developer ID signed or notarized**. Gatekeeper can still reject them; valid ad hoc bundle signatures do not imply Gatekeeper approval. Windows installers are unsigned and may show a SmartScreen reputation warning. No Gatekeeper, quarantine, or SmartScreen setting is changed by Vhostra.

The application identifier, executable names, installation paths, and user-data locations are unchanged. This release adds no storage migration, privileged background service, or machine-wide runtime. Upgrading or uninstalling does not require deleting settings, Sites, document roots, databases, certificates, backups, or Docker data.

## Verification scope and known limits

The installer-fix branch passed a six-runner GitHub Actions matrix for macOS, Windows, and Linux x64/ARM64. That is **automated CI verification**, not installation on physical devices. The v1.0.8 candidate must pass its own ten-artifact matrix and checksum gate before tagging or publication is considered. Native Intel Mac installation, physical Windows/Linux installation, RPM installation on an RPM-based system, Linux GUI launch, and AppImage desktop integration remain unverified unless separately recorded. See the [installation guide](install.md) for package selection and current security-warning guidance.
