# Install Vhostra

These instructions describe the **v1.0.8 release candidate**. No v1.0.8 download is available until the release is approved and published. When it is available, download the package for your operating system and CPU from the [official GitHub Releases page](https://github.com/karunofficial96/vhostra/releases). Compare its SHA-256 hash with the release's `SHA256SUMS` file before opening it. A checksum match checks the downloaded bytes; it is not a substitute for reviewing an operating-system security warning.

Vhostra keeps settings and managed data in your user profile. Replacing or uninstalling the application does not call for deleting Sites, document roots, databases, certificates, backups, or Docker data. Docker Desktop or a compatible Docker Engine with Compose is a separate prerequisite for starting Vhostra services; Vhostra does not install it for you.

## macOS

Choose `Vhostra-1.0.8-macos-arm64.dmg` for Apple Silicon or `Vhostra-1.0.8-macos-x64.dmg` for Intel. Check the downloaded file against `SHA256SUMS`, for example:

```bash
shasum -a 256 Vhostra-1.0.8-macos-arm64.dmg
```

Open the DMG and drag `Vhostra.app` to Applications. The app and its nested Electron code are consistently **ad hoc signed**, but they are **not Apple Developer ID signed or notarized**. macOS Gatekeeper can reject a downloaded app even when its DMG and bundle signatures are internally valid. An ordinary first-launch warning therefore remains possible.

If macOS says it cannot check the app for malicious software or identifies an unknown developer, first confirm the source and checksum. After attempting to open it, macOS may offer **Open Anyway** in **System Settings → Privacy & Security**; follow the prompts only if you trust that specific copy. [Apple describes this as a per-app exception](https://support.apple.com/102445). It is not available for every warning or every managed Mac. If macOS reports that the app is damaged, contains malware, or cannot be opened, stop and report the exact message and checksum; do not assume that the per-app option will work.

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
