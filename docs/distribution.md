# Vhostra distribution

The source repository is `https://github.com/karunofficial96/vhostra`. `package.json` is the version source. The manual [Package and release Vhostra](../.github/workflows/package-native.yml) workflow checks out an existing `v<package-version>` tag. It builds on native runners and uploads workflow artifacts. Selecting its `publish` option publishes to GitHub Releases only after all ten expected files have been verified. The release job writes `SHA256SUMS` and `release-manifest.json` from the actual bytes and fails on a missing or unexpected package. Normal pushes do not publish anything. The workflow has not yet run; do not treat these configured targets as released assets.

| Artifact | Native runner | CLI path |
| --- | --- | --- |
| `Vhostra-<version>-windows-x64.exe` | Windows x64 | NSIS adds stable install directory to user PATH |
| `Vhostra-<version>-windows-arm64.exe` | Windows arm64 | Same |
| `Vhostra-<version>-macos-arm64.dmg` | macOS arm64 | First launch from Applications offers macOS authorization for `/usr/local/bin/vhostra` if needed |
| `Vhostra-<version>-macos-x64.dmg` | macOS Intel | Same |
| `Vhostra-<version>-linux-x86_64.rpm` | Linux x64 | Package-owned `/usr/bin/vhostra` link |
| `Vhostra-<version>-linux-aarch64.rpm` | Linux arm64 | Same |
| `Vhostra-<version>-linux-amd64.deb` | Linux x64 | Same |
| `Vhostra-<version>-linux-arm64.deb` | Linux arm64 | Same |
| `Vhostra-<version>-linux-x86_64.AppImage` | Linux x64 | Explicit **Install CLI** in About when `~/.local/bin` is already on PATH |
| `Vhostra-<version>-linux-arm64.AppImage` | Linux arm64 | Same |

Windows NSIS calls the packaged Electron runtime to edit only HKCU user PATH. It preserves the registry value type and unrelated entries, refuses an overlong result, records ownership only when it adds an entry, and broadcasts the environment change. Upgrade does not duplicate the entry. Uninstall removes only its owned entry. A new Command Prompt, PowerShell, or Windows Terminal session is needed to inherit the change. No separate Node installation is needed.

macOS DMG installation is the normal Finder drag to Applications. At first launch from Applications, Vhostra creates a link to its packaged CLI in `/usr/local/bin` if vacant. A protected directory triggers the normal macOS administrator prompt. An unrelated command is never overwritten. **Remove CLI** in About removes only the link to this app; use it before moving the app to Trash. Finder's Trash action alone cannot execute an uninstall hook, so it cannot remove the link automatically. A moved app may need **Install CLI** again. The app does not edit shell profiles.

DEB/RPM package hooks install and remove only the exact link to `/opt/Vhostra/vhostra`, in addition to electron-builder's desktop integration. A preexisting unrelated `/usr/bin/vhostra` is kept. The AppImage is portable and cannot change PATH merely by being downloaded. Its About action creates one small owned wrapper in `~/.local/bin` only if that directory is already on PATH; **Remove CLI** deletes only that wrapper. AppImage wrapper execution requires native Linux acceptance before release.

Docker remains a separate third-party prerequisite. Vhostra checks the CLI and daemon locally on launch and distinguishes ready, missing, stopped, broken, and timeout. A missing installation requires consent before opening [Docker's official instructions](https://docs.docker.com/desktop/). The user completes Docker's installation and terms, then selects **Check Again**. Vhostra does not bundle or silently install Docker. Docker Desktop's [Windows page](https://docs.docker.com/desktop/setup/install/windows-install/) lists x64 and an Arm early-access download; its [Mac page](https://docs.docker.com/desktop/setup/install/mac-install/) separates Apple Silicon and Intel. [Docker Engine](https://docs.docker.com/engine/install/) documents Linux architectures by distribution; Docker Desktop for Linux is more restricted. Vhostra never guesses an unsupported Docker package or modifies repositories.

**Check for Updates** makes one bounded GET to `https://api.github.com/repos/karunofficial96/vhostra/releases/latest` only after the button is clicked. It sends no profile, site, Docker, device, PATH, or installation identifier. GitHub receives ordinary connection and HTTP request data. The release metadata must contain the exact file for the running OS and CPU architecture; otherwise Vhostra offers no download. **Download Update** opens that exact official asset only after a second click. No automatic download, install, restart, scheduled task, or update history is added.

Normal removal preserves user configuration, Sites, site roots, MariaDB raw data and backups. None of the packages remove Docker or prune unrelated Docker resources. Current artifacts are unsigned or ad hoc signed. Production distribution needs a Windows signing certificate and Apple Developer signing/notarization credentials, supplied through GitHub Actions secrets, plus native install/run/uninstall acceptance on disposable machines. No signing secrets are stored in the repository.
