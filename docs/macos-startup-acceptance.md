# macOS startup and shutdown acceptance

Electron's `powerMonitor` emits `shutdown` when macOS is about to reboot or shut down. Vhostra uses that confirmed signal to allow ordinary Electron cleanup without a quit confirmation or Docker stop. The signal is not documented for logout. Electron's `query-session-end` and `session-end` window events are Windows-only, so a macOS logout that reaches ordinary `before-quit` may still prompt. Vhostra does not guess from unrelated quit events because that would also suppress confirmation for intentional quits. No native logout hook is included in this maintenance change.

Electron documents that macOS login item settings may silently fail for apps that are not packaged, signed, and notarized. The current package uses an unsigned identity. The app checks the operating system's reported registration status, but this cannot prove that macOS will actually launch it after login. The background-only combination uses the main app's per-user login item and does not create its main window; it does not install a daemon or helper. If physical acceptance fails under the current package, the smallest safe alternative is to keep Launch Vhostra on Login on and start services from the visible app after Docker becomes ready, then ship background-only behavior once signed/notarized login-item reliability is established.

## Physical checklist

Use an isolated test profile and test services; keep a copy of its Site definitions, document roots, MariaDB data, certificates, settings, and backups. On a real Mac with Docker Desktop installed:

1. Test Manual and Run Services When Vhostra Opens with Launch Vhostra on Login both unchecked and checked. Select Run Services on Login and confirm it unchecks and disables window launch; switch away and confirm window launch stays unchecked. Restart Vhostra and verify the settings persist. Check macOS Login Items for registration whenever login launch is selected and removal otherwise.
2. Log out and back in for each state. Manual without window launch leaves Vhostra closed; with it checked, the window opens but services do not start. Run Services When Vhostra Opens without window launch starts services only after manually opening Vhostra; with it checked, the window opens and services start at login. Run Services on Login starts enabled services with no main window; confirm the tray item is available.
3. Repeat the automatic startup cases with Docker Desktop slow to become ready, then with Docker Desktop stopped. Confirm bounded completion and inspect `application.log` in the Vhostra log directory for a useful failure message. Reopen Vhostra and confirm Runtime Status is actionable.
4. Repeat with services already running, and with Redis and Memcached disabled. Confirm there is no duplicate Compose operation and disabled services remain disabled.
5. Choose Quit Vhostra and press Command-Q. Confirm the intentional quit prompt still appears. Repeat with title-bar Close under each configured close behavior.
6. Restart and shut down macOS with Vhostra open. Confirm no Vhostra prompt delays either action. Test logout separately and record whether macOS invokes a distinguishable shutdown event; logout suppression is not guaranteed by Electron's documented API.
7. Reopen the profile and confirm Sites, external document-root files, MariaDB databases, Docker volumes, certificates, settings, and backups are intact.

Automated tests cover settings persistence, login policy combinations, delayed and unavailable Docker, duplicate startup, running services, and preservation of Site and data markers. They cannot establish physical login-item launch, macOS event ordering, logout behavior, or Docker Desktop timing on a user's Mac.
