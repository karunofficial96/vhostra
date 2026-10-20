# macOS startup and shutdown acceptance

Electron's `powerMonitor` emits `shutdown` when macOS is about to reboot or shut down. Vhostra uses that confirmed signal to allow ordinary Electron cleanup without a quit confirmation or Docker stop. The signal is not documented for logout. Electron's `query-session-end` and `session-end` window events are Windows-only, so a macOS logout that reaches ordinary `before-quit` may still prompt. Vhostra does not guess from unrelated quit events because that would also suppress confirmation for intentional quits. No native logout hook is included in this maintenance change.

Electron documents that macOS login item settings may silently fail for apps that are not packaged, signed, and notarized. The current package uses an unsigned identity. The app checks the operating system's reported registration status, but this cannot prove that macOS will actually launch it after login. The background-only combination uses the main app's per-user login item and does not create its main window; it does not install a daemon or helper. If physical acceptance fails under the current package, the smallest safe alternative is to keep Launch Vhostra on Login on and start services from the visible app after Docker becomes ready, then ship background-only behavior once signed/notarized login-item reliability is established.

## Physical checklist

Use an isolated test profile and test services; keep a copy of its Site definitions, document roots, MariaDB data, certificates, settings, and backups. On a real Mac with Docker Desktop installed:

1. Check each of the four Launch/Run combinations in Settings. Restart Vhostra and confirm both checkboxes retain their values. Check macOS Login Items for registration when either is on and removal when both are off.
2. With both off, log out and back in. Confirm Vhostra stays closed. With Launch on and Run off, confirm the window appears and services do not start. With Launch off and Run on, confirm no main window appears, the tray item is available, and enabled services start. With both on, confirm the window appears and enabled services start.
3. Repeat the Run on cases with Docker Desktop slow to become ready, then with Docker Desktop stopped. Confirm bounded completion and inspect `application.log` in the Vhostra log directory for a useful failure message. Reopen Vhostra and confirm Runtime Status is actionable.
4. Repeat with services already running, and with Redis and Memcached disabled. Confirm there is no duplicate Compose operation and disabled services remain disabled.
5. Choose Quit Vhostra and press Command-Q. Confirm the intentional quit prompt still appears. Repeat with title-bar Close under each configured close behavior.
6. Restart and shut down macOS with Vhostra open. Confirm no Vhostra prompt delays either action. Test logout separately and record whether macOS invokes a distinguishable shutdown event; logout suppression is not guaranteed by Electron's documented API.
7. Reopen the profile and confirm Sites, external document-root files, MariaDB databases, Docker volumes, certificates, settings, and backups are intact.

Automated tests cover settings persistence, login policy combinations, delayed and unavailable Docker, duplicate startup, running services, and preservation of Site and data markers. They cannot establish physical login-item launch, macOS event ordering, logout behavior, or Docker Desktop timing on a user's Mac.
