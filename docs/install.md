# Install Vhostra

These instructions describe the published **v1.0.8** release. Download the package for your operating system and CPU from the [official GitHub Releases page](https://github.com/karunofficial96/vhostra/releases). Compare its SHA-256 hash with the release's `SHA256SUMS` file before opening it. A checksum match checks the downloaded bytes against the published file; it does not independently prove that the software is safe.

Vhostra keeps settings and managed data in your user profile. Replacing or uninstalling the application does not call for deleting Sites, document roots, databases, certificates, backups, or Docker data. Docker Desktop or a compatible Docker Engine with Compose is a separate prerequisite for starting Vhostra services; Vhostra does not install it for you.

## macOS

Choose the macOS ARM64 DMG for Apple Silicon or the macOS x64 DMG for Intel from the [v1.0.8 release](https://github.com/karunofficial96/vhostra/releases/tag/v1.0.8). Download `SHA256SUMS` and `release-manifest.json` from the same release. In Terminal, substitute the exact name of the DMG you downloaded:

```bash
shasum -a 256 "ACTUAL_DOWNLOADED_FILENAME.dmg"
```

Find that exact DMG filename in `SHA256SUMS` and compare its 64-character SHA-256 value with the Terminal result. The values must match before you open the DMG. `release-manifest.json` also lists the published artifacts and hashes. Matching the published checksum shows that your downloaded bytes are consistent with that file; it does not independently establish that the software is safe.

### macOS Gatekeeper and Apple Notarization

**Ad hoc signing** checks that the code in the app bundle is internally consistent, but it does not identify Vhostra's publisher to Apple. **Apple Developer ID signing** uses an Apple-issued certificate to identify a developer and detect changes to signed code. **Apple notarization** is a separate Apple review for known malicious software. Vhostra v1.0.8 is ad hoc signed; it is **not Developer ID signed or notarized**. Apple has not notarized this release, and it is not Apple-certified.

Gatekeeper may show: “Apple could not verify 'Vhostra' is free of malware that may harm your Mac or compromise your privacy.” The exact wording may vary by macOS version. This warning alone does not prove Vhostra contains malware, and it does not guarantee that the app is safe. Gatekeeper may reject a downloaded app even when its DMG and internal bundle signatures are valid.

If you trust the release source and the checksum matches, use Apple's per-app approval option **only if macOS offers it for this copy**:

1. Open the downloaded DMG and drag `Vhostra.app` into **Applications**.
2. Try opening Vhostra from Applications normally.
3. If the Apple verification warning blocks it, click **Done** if that button appears.
4. Open **System Settings → Privacy & Security** and scroll to the **Security** section.
5. Click **Open Anyway** for Vhostra if it appears, then authenticate and confirm the follow-up **Open** prompt.

[Apple's Mac User Guide](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unidentified-developer-mh40616/mac) describes this per-app exception. The button is generally available for about an hour after you try opening the app. It may be unavailable on a managed Mac or for some kinds of security warning.

If **Open Anyway** does not appear, try opening the copy in Applications once more and check Privacy & Security promptly. If it still does not appear, or if Vhostra still cannot open after approval, stop and record the exact macOS message and the DMG checksum when reporting the problem. If macOS says the app is **damaged**, download a fresh DMG from the official v1.0.8 release and verify its checksum. If that copy also reports damage, stop and report it; do not assume this is an ordinary unnotarized-app warning. Treat a malware warning as a separate security concern.

Do not disable macOS security protections globally, remove quarantine attributes, or use `sudo` to bypass macOS security checks.

Vhostra v1.0.8 was installed and tested on a **MacBook Pro M2 Pro running macOS**. Application launch, Docker Desktop integration, OpenLiteSpeed, PHP, MariaDB, phpMyAdmin, localhost, existing local websites, and CLI commands worked in that test. Physical Intel Mac installation has not been verified. CI packaging checks for other platforms are not physical Windows or Linux installation tests.

Vhostra can optionally install its packaged `vhostra` CLI link from the app's About screen. macOS may request administrator approval for `/usr/local/bin`. The app does not change your shell profile. Moving the app to Trash does not run an uninstall hook; use **Remove CLI** before removing the app if you installed that link. Keep your user-data directory and any external site roots when upgrading or uninstalling.

## Windows

Choose `Vhostra-1.0.8-windows-x64.exe` for x64 Windows or `Vhostra-1.0.8-windows-arm64.exe` for Windows on ARM. In PowerShell, compare the downloaded file's hash with `SHA256SUMS`:

```powershell
Get-FileHash .\Vhostra-1.0.8-windows-x64.exe -Algorithm SHA256
```

Run the NSIS installer and choose the per-user installation. It adds the installed Vhostra CLI directory to your **user** PATH; open a new terminal to use `vhostra`. Reinstalling does not add duplicate PATH entries, and uninstalling removes only the entry Vhostra owns. The uninstaller is configured to preserve application data.

The installer is not Authenticode signed. [Microsoft Defender SmartScreen](https://learn.microsoft.com/en-us/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/) may warn that a downloaded program has no established reputation. Review the source and checksum and proceed only if Windows offers a user choice and you trust the file. A SmartScreen warning alone does not establish an installer defect. Do not turn off Windows security features globally.

## Linux

Choose the file that matches both your distribution's package format and CPU. Package managers resolve the declared system-library dependencies from your configured repositories; review any proposed dependencies before approving installation. The desktop app needs a graphical session. Docker with Compose is required only when starting Vhostra's managed services.

On Debian or Ubuntu, install a local DEB with APT:

```bash
sudo apt install ./Vhostra-1.0.8-linux-amd64.deb  # x64
# or: sudo apt install ./Vhostra-1.0.8-linux-arm64.deb
```

On a DNF-based distribution, install a local RPM:

```bash
sudo dnf install ./Vhostra-1.0.8-linux-x86_64.rpm  # x64
# or: sudo dnf install ./Vhostra-1.0.8-linux-aarch64.rpm
```

DEB and RPM packages add a desktop entry and an owned `/usr/bin/vhostra` CLI link. Use your package manager to remove the package (`sudo apt remove vhostra` or `sudo dnf remove vhostra`). Package removal does not remove your Vhostra profile, Sites, databases, certificates, or Docker data.

The AppImage is portable. For x64 use `Vhostra-1.0.8-linux-x86_64.AppImage`; for ARM64 use `Vhostra-1.0.8-linux-arm64.AppImage`. Mark your downloaded copy executable, then run it:

```bash
chmod +x ./Vhostra-1.0.8-linux-x86_64.AppImage
./Vhostra-1.0.8-linux-x86_64.AppImage
```

AppImages normally use FUSE. If your system lacks working FUSE, the [AppImage project documents extract-and-run](https://docs.appimage.org/user-guide/troubleshooting/fuse.html): `APPIMAGE_EXTRACT_AND_RUN=1 ./Vhostra-1.0.8-linux-x86_64.AppImage`. This is slower and needs temporary disk space. The AppImage does not install a system package or desktop entry by itself. Its optional **Install CLI** action creates a wrapper in `~/.local/bin` only when that directory is already on PATH; **Remove CLI** removes the owned wrapper. To remove the AppImage, delete only the downloaded AppImage file and any optional wrapper, leaving user data intact.

The package commands above follow [Ubuntu's local DEB guidance](https://documentation.ubuntu.com/project/contributors/bug-fix/install-built-packages/), [Red Hat's local RPM guidance](https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/managing_software_with_the_dnf_tool/assembly_installing-rhel-9-content_managing-software-with-the-dnf-tool), and the [AppImage quickstart](https://docs.appimage.org/introduction/quickstart.html).
