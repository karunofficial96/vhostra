# Vhostra v1.0.7 installer audit

Audit date: 2026-10-08. The [published v1.0.7 release](https://github.com/karunofficial96/vhostra/releases/tag/v1.0.7) and its [successful packaging run](https://github.com/karunofficial96/vhostra/actions/runs/37141206487) remain unchanged. This branch contains candidate fixes only.

## Confirmed macOS failure

Both official DMGs were downloaded independently. Their SHA-256 values match the release's `SHA256SUMS` file and GitHub asset digests. `hdiutil verify` reports valid disk-image checksums for both. The images contain the expected `Vhostra.app`, executable CLI launcher, Electron framework, app archive, and executable permissions. The ARM64 image contains ARM64 Mach-O binaries; the Intel image contains x86_64 binaries. The app bundle's version and identifier are 1.0.7 and `com.vhostra.app`.

| Official DMG | SHA-256 | Bundle signature | Gatekeeper assessment |
| --- | --- | --- | --- |
| `Vhostra-1.0.7-macos-arm64.dmg` | `deebf72ca42c4d0a8355fa4402e9d8c50be047516334afc627bd5a4eeee7b21b` | **FAIL:** `codesign --verify --deep --strict` says the app has no sealed resources; the nested Electron framework fails the same way. The main Mach-O has only a linker ad hoc signature. | `spctl` reports an internal code-signing subsystem error. |
| `Vhostra-1.0.7-macos-x64.dmg` | `56b30bb14c7fc949bfdf5c3c3651397737f3515b1d0694472977efb5887df935` | **FAIL:** app and nested Electron framework are not signed at all. | `spctl` reports an internal code-signing subsystem error. |

The release workflow set `CSC_IDENTITY_AUTO_DISCOVERY=false`, and the macOS build configuration did not request any other signing identity. Electron-builder therefore skipped final bundle signing. The ARM64 executable's linker signature did not seal the app or its frameworks. The user-visible “damaged” message is consistent with these invalid or missing bundle signatures when a downloaded app is assessed by Gatekeeper. The disk images themselves are intact. These findings do not establish the quarantine attribute on the user's uninstalled copy: the copies fetched with `curl` have no `com.apple.quarantine` attribute, and the user's original copy is unavailable.

The official ARM64 app launched directly from its read-only DMG with `VHOSTRA_TEST_SCOPE` and a temporary user-data directory, and its renderer showed the expected stopped-Docker state. This separates runtime launch from Gatekeeper assessment. On the Apple Silicon audit Mac, the official Intel app's first Rosetta GUI run exceeded the isolated test's 15-second startup window. Its packaged CLI then passed, and a second isolated GUI run passed. Native Intel hardware installation remains **NOT VERIFIED**.

## Candidate fix and limits

The candidate config explicitly sets `mac.identity` to `"-"`. Electron-builder now ad hoc signs the complete app and nested Electron code with its default hardened runtime setting. The locally rebuilt ARM64 DMG passed image verification, mounted read-only, and passed strict `codesign` verification for the app, Electron framework, and every helper app. The rebuilt app was copied into an isolated temporary install directory; its GUI and packaged CLI both passed tests with temporary user data. `spctl` returned a clear **rejected** result for this ad hoc, unnotarized build.

Ad hoc signing fixes signature consistency; it does not provide Developer ID trust or Apple notarization. Without an Apple Developer membership, ordinary downloaded installation may still produce Gatekeeper warnings or require a user-directed, per-app security decision. No quarantine attribute was removed, Gatekeeper was not disabled, and no system-wide exception was installed. The existing per-user storage and runtime architecture were not changed.

## Ten published artifacts

The v1.0.7 release published ten artifact files and a checksum manifest. The successful release CI run built each architecture and checked package naming and executable architecture. The statuses below distinguish that CI evidence from installation on a physical target machine.

| Artifact | v1.0.7 installation evidence | Physical target status |
| --- | --- | --- |
| macOS ARM64 DMG | **FAIL:** intact image, invalid bundle signatures; direct isolated launch works. | Installation blocked by Gatekeeper; repaired candidate was temp-installed and launched locally. |
| macOS x64 DMG | **FAIL:** intact image, unsigned app/framework; CLI and GUI launch through Rosetta passed after the first GUI timeout. | **NOT VERIFIED** on Intel hardware. |
| Windows x64 NSIS EXE | CI installed per user, checked installed PE x64, CLI, PATH, reinstall, and uninstaller. | **NOT VERIFIED** on physical Windows x64. |
| Windows ARM64 NSIS EXE | CI installed per user, checked installed PE ARM64, CLI, PATH, reinstall, and uninstaller. | **NOT VERIFIED** on physical Windows ARM64. |
| Linux amd64 DEB | CI used `apt-get install`, checked CLI and owned symlink, then removed package. | **NOT VERIFIED** on physical Linux x64. |
| Linux arm64 DEB | CI used `apt-get install`, checked CLI and owned symlink, then removed package. | **NOT VERIFIED** on physical Linux ARM64. |
| Linux x86_64 RPM | CI checked RPM architecture and unpacked executable/CLI. No RPM installation was run. | **NOT VERIFIED** on an RPM-based x64 system. |
| Linux aarch64 RPM | CI checked RPM architecture and unpacked executable/CLI. No RPM installation was run. | **NOT VERIFIED** on an RPM-based ARM64 system. |
| Linux x86_64 AppImage | CI checked ELF architecture and ran the AppImage CLI with extract-and-run mode. GUI launch and desktop integration were not tested. | **NOT VERIFIED** on physical Linux x64. |
| Linux arm64 AppImage | CI checked ELF architecture and ran the AppImage CLI with extract-and-run mode. GUI launch and desktop integration were not tested. | **NOT VERIFIED** on physical Linux ARM64. |

The published Windows installers are unsigned, so Windows SmartScreen can warn even when installation is otherwise working. This warning is distinct from an NSIS installation defect. The config specifies per-user NSIS installation and `deleteAppDataOnUninstall: false`; the v1.0.7 workflow's prior temporary-file fixture did not actually prove preservation of Vhostra user data. The updated workflow places preservation fixtures in the Vhostra user-data locations for future runs. Linux package hooks remove only their owned CLI link; they do not delete the user's site/configuration directory. Future CI also inspects package dependencies, installed executable paths and desktop files. RPM installation, Linux GUI launch, AppImage desktop integration, and real user-data preservation remain to be verified on target systems.

## Verification performed on this branch

- `npm run build`: passed as part of the test command.
- `node --test test/*.test.mjs`: 147 passed with localhost access. The first sandboxed run failed on `listen EPERM 127.0.0.1`; rerunning with localhost access passed.
- `node --test test/release-matrix.test.mjs`: 4 passed.
- ARM64 `electron-builder` DMG build: passed. `scripts/verify-macos-artifact.sh` passed on the resulting DMG.
- Fixed ARM64 app: strict signature verification passed after temporary copy-install; isolated GUI and packaged CLI tests passed. Gatekeeper rejected the unnotarized app as expected.
- The updated multi-platform GitHub Actions workflow has not run on this branch. It will run against a future reviewed tag; running the old v1.0.7 tag would check out the old workflow and packaging configuration.

No v1.0.7 release asset was modified, and no user data was deleted or migrated.
