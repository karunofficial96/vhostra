# Startup and shutdown acceptance for the next maintenance release

Status: **No physical operating-system login, logout, shutdown, or installation tests were performed for these changes.** Automated tests on the development Mac use platform mocks for Windows and Linux. Complete the checks below on actual machines before claiming platform support for this release.

## Supported mechanisms and limits

| Platform | Login launch | Confirmed session end | Limit |
| --- | --- | --- | --- |
| macOS | Electron per-user main-app login item; `wasOpenedAtLogin` identifies OS login launch | Electron `powerMonitor.shutdown` for reboot/shutdown | Electron does not document a distinct logout signal. An ordinary `before-quit` at logout can still prompt. Current unsigned/unnotarized packages may not launch reliably as login items. |
| Windows | Electron per-user login item with `--vhostra-login-start` argument | BrowserWindow `query-session-end` and `session-end` cover sign-out, restart, shutdown | Window events require a window. Electron documents that normal `before-quit` is not emitted for Windows OS termination; physically verify background-only behavior. |
| Linux | Per-user `$XDG_CONFIG_HOME/autostart/vhostra.desktop` or `~/.config/autostart/vhostra.desktop`; `--vhostra-login-start` argument | Electron `powerMonitor.shutdown` for reboot/shutdown where the desktop emits it | XDG autostart needs a compatible graphical desktop session. Electron does not document a portable logout signal; behavior varies by desktop environment. No headless-session startup is provided. |

The Windows and Linux argument identifies the Vhostra login registration's launch path; a person can also supply it manually. It is not treated as an authentication or security boundary. No system-wide service or privileged helper is installed. Docker itself must be running or become ready during Vhostra's bounded retry window. Vhostra does not configure Docker Desktop or Docker Engine to start at login.

Electron API references: [BrowserWindow session end](https://www.electronjs.org/docs/latest/api/browser-window/#event-query-session-end-windows), [powerMonitor shutdown](https://www.electronjs.org/docs/latest/api/power-monitor/#event-shutdown-linux-macos), [login items](https://www.electronjs.org/docs/latest/api/app/#appsetloginitemsettingssettings-macos-windows). Linux behavior follows the [XDG Autostart specification](https://specifications.freedesktop.org/autostart-spec/latest/) and [Desktop Entry specification](https://specifications.freedesktop.org/desktop-entry-spec/latest/).

## Checklist for each target

Run the numbered checks separately for **macOS ARM64**, **macOS x64**, **Windows x64**, **Windows ARM64**, **Linux x64**, and **Linux ARM64**. For each Linux architecture, run them for **DEB**, **RPM**, and **AppImage** on distributions that support those formats; record desktop environment and X11/Wayland session. The current evidence for every target below is **not physically tested**.

1. Install the correct architecture package. For AppImage, place it at a stable executable path before enabling autostart. Record OS version, package type, architecture, desktop environment, and Docker version.
2. Set each of the four Launch Vhostra / Run Services combinations. Restart the app after each change and verify the displayed values remain independent. Check that the per-user login registration exists when either preference is on and is absent when both are off.
3. For each combination, restart the computer and log in. Confirm: OFF/OFF launches nothing; ON/OFF opens the window without automatic service startup; OFF/ON starts enabled services with no main window; ON/ON opens the window and starts enabled services. For AppImage, inspect the autostart `Exec` path after a reboot and after moving the AppImage.
4. Repeat OFF/ON and ON/ON while Docker starts slowly, and with Docker unavailable. Confirm the desktop remains responsive, startup ends within the retry window, and `application.log` explains failure. Then start Docker and use Vhostra's normal Start Services action.
5. Repeat with services already running and with a partially running runtime (for example, web running with MariaDB stopped). Confirm no duplicate Compose start for running services. Confirm Redis and Memcached remain stopped when disabled.
6. Trigger manual Quit from the application menu or tray and verify the confirmation. Close the main window and verify its configured close behavior.
7. Test OS logout/sign-out, restart, and shutdown with Vhostra open and again in background-only mode. Confirm no Vhostra dialog when the OS exposes a confirmed session-end signal; record any prompt, delay, or desktop-specific behavior. On macOS and Linux, note the documented logout uncertainty rather than assuming success.
8. After login, verify all existing Sites, external document-root files, MariaDB databases, Docker volumes, certificates, settings, and backups remain intact. Compare representative files and database tables before and after.
9. Run the packaged `vhostra` CLI help and a read-only status command. For AppImage, check the optional user CLI wrapper if installed. Verify the desktop startup changes did not alter the CLI path or profile.

The [macOS-specific checklist](macos-startup-acceptance.md) adds details for that platform. Record observed results separately for every architecture/package combination; mocked tests and a package build do not replace these physical checks.
