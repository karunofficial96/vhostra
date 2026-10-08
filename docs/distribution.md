# Vhostra distribution

`package.json` is the version source; `package-lock.json` carries the matching root package version. The current release candidate is **1.0.8**. See the [installation guide](install.md) for user-facing package selection and security-warning instructions, and the [draft release notes](release-notes-v1.0.8.md) for changes.

The manual [Package and release Vhostra](../.github/workflows/package-native.yml) workflow can verify a branch with a blank `tag` and `publish=false`. It builds on native macOS, Windows and Linux x64/ARM64 runners, runs platform packaging checks, merges exactly ten artifact files, and generates and verifies `SHA256SUMS` and `release-manifest.json`. A tagged run checks that `v<package-version>` exists and matches the package version. Only a separate tagged run with `publish=true` can invoke the release job. Normal pushes do not publish anything.

| Package | Native runner | Packaged CLI |
| --- | --- | --- |
| `Vhostra-<version>-windows-x64.exe` | Windows x64 | Installed `vhostra.cmd`; per-user PATH |
| `Vhostra-<version>-windows-arm64.exe` | Windows ARM64 | Same |
| `Vhostra-<version>-macos-arm64.dmg` | macOS Apple Silicon | `Vhostra.app/Contents/Resources/bin/vhostra` |
| `Vhostra-<version>-macos-x64.dmg` | macOS Intel | Same |
| `Vhostra-<version>-linux-x86_64.rpm` | Linux x64 | Package-owned `/usr/bin/vhostra` link |
| `Vhostra-<version>-linux-aarch64.rpm` | Linux ARM64 | Same |
| `Vhostra-<version>-linux-amd64.deb` | Linux x64 | Same |
| `Vhostra-<version>-linux-arm64.deb` | Linux ARM64 | Same |
| `Vhostra-<version>-linux-x86_64.AppImage` | Linux x64 | Optional `~/.local/bin/vhostra` wrapper |
| `Vhostra-<version>-linux-arm64.AppImage` | Linux ARM64 | Same |

Windows NSIS installs per user, edits only the user PATH, records ownership when it adds an entry, and removes only its owned entry on uninstall. Reinstall does not duplicate the entry. `deleteAppDataOnUninstall` is false. A new terminal is needed to inherit the PATH change.

The macOS apps use consistent ad hoc bundle signing, including Electron frameworks. They are not Developer ID signed or notarized; Gatekeeper can still reject downloaded apps. Vhostra's optional **Install CLI** action may request normal macOS approval to create `/usr/local/bin/vhostra`. It does not edit shell profiles. Finder removal cannot run an uninstall hook; use **Remove CLI** before moving the app to Trash if the CLI link was installed.

DEB/RPM packages install desktop integration and an owned `/usr/bin/vhostra` link. Their hooks preserve any unrelated command at that path. The AppImage is portable; its About screen can add a wrapper in `~/.local/bin` only when that directory is already on PATH. Package removal does not delete the Vhostra user profile, Sites, document roots, databases, certificates, backups, or Docker data. Docker remains a separate prerequisite for starting managed services and is never silently installed or pruned by Vhostra.

Windows packages are unsigned and may trigger SmartScreen warnings. CI checks are automated runner tests, not physical-device acceptance. RPM installation on an RPM-based system, native Intel Mac installation, physical Windows/Linux installation, Linux GUI launch and AppImage desktop integration remain separate acceptance items. The [v1.0.7 installer audit](installer-audit-v1.0.7.md) records the defect diagnosis and the verified fix without changing that historical release.
