# Vhostra

Vhostra is a lightweight, cross-platform graphical local PHP development environment. It is designed around one shared runtime: many local websites use one selected web server, one selected PHP version, and shared supporting services.

> Development status: Vhostra persists settings and site/neutral-vhost definitions locally, creates a protected localhost welcome page, and manages its dedicated single-container runtime. The current desktop UI includes real MariaDB management, phpMyAdmin launching, port checks, hosts-file integration, PHP extension discovery, and runtime lifecycle controls. Portable JSON configuration import/apply and verified configuration-location migration are implemented. Arbitrary server-config parsing, screenshot capture, and external backup restore remain pending.

## Features

- Electron desktop application for macOS, Windows, and Linux
- React, TypeScript, Vite, and Tailwind CSS interface
- Responsive, collapsible navigation for Dashboard, Sites, Virtual Hosts, Database, phpMyAdmin, Server, PHP, Services, Logs, and Settings
- Dashboard and tray backed by the same real Docker-runtime status, with Start, Stop, and Restart actions
- Add, edit, and remove site definitions without changing document-root files
- Native document-root folder selection and secure OS-default browser opening for local site URLs
- Persisted selected web server, PHP version, and Redis/Memcached preferences
- First-run defaults of OpenLiteSpeed and the latest supported PHP policy (currently PHP 8.5)
- Protected, server-neutral `http://localhost/` definition with a static host-side Vhostra welcome page
- System tray/menu-bar entry that keeps Vhostra available after its window closes
- Configuration bundle export, validation preview, and import
- Typed, server-neutral virtual-host model used for portable imports and server configuration generation
- Typed local-first storage layout, configuration ownership, snapshot, and portable bundle models
- Exact-source macOS, Windows, Linux, window, and favicon application icons
- Authoritative branding assets derived directly from `logo/logos.png`
- PHP extension inventory obtained from the selected LSPHP package catalog when the runtime is running; selected optional extensions are installed into the replacement image and checked through the real PHP request path
- Zend OPcache preference and `cwebp` support (enabled by default); `cwebp` is supplied by the runtime’s `webp` package and validated in the runtime health check
- Hosts-file mappings for virtual-host hostnames and aliases, using a narrow elevation prompt rather than running the app with permanent administrator privileges
- Launch-on-login and optional runtime-start-on-launch preferences

## Architecture summary

Vhostra runs exactly one global web server and exactly one global PHP runtime at a time. Websites are vhosts within that shared environment—not individual stacks. MariaDB and phpMyAdmin are required shared services; Redis and Memcached are optional shared services.

Supported web servers: Apache, Nginx, and OpenLiteSpeed. Only the selected implementation is used.

Supported PHP versions: PHP 8.1, 8.2, 8.3, 8.4, and 8.5.

### First-run environment defaults

New Vhostra profiles select OpenLiteSpeed. PHP uses a `latestSupported` policy: it resolves from the supported PHP-version list rather than embedding a permanent version value; at present that resolves to PHP 8.5. MariaDB and phpMyAdmin remain required shared services. Redis and Memcached remain optional and disabled by default. All of these preferences are persisted when changed.

Vhostra also creates a protected, server-neutral localhost site definition at `http://localhost/`. Its document root is created under Vhostra's host-side data directory and contains a lightweight static Tailwind welcome page with current saved preferences, runtime status, and links to configured sites. When services are running, it is served through the selected web server rather than Electron or Vite.

## Docker runtime and ports

Docker Desktop (or a compatible Docker Engine with the Compose plugin) is required. Start Services verifies Docker, checks required host ports, generates and validates the Vhostra-only Compose project, and starts the selected stack.

- `http://localhost:9000` is the Vite development UI only.
- `http://localhost/` is the Vhostra managed local web-server entry point.
- `http://localhost:9080/` is phpMyAdmin. Its image keeps internal port 80; only the host binding is 9080.

Vhostra checks the configured HTTP, phpMyAdmin, and MariaDB ports before startup (defaults 80, 9080, and 3306). Port 443 is checked only as an optional HTTPS capability: if another application such as Tailscale Serve owns it, Vhostra starts HTTP normally on port 80 and reports HTTPS as unavailable without touching the owner.

## Local-first storage and persistence

Vhostra keeps its application data in Electron's platform-specific `userData` location, under a `vhostra` directory. Website document roots are normal user-selected or user-created host directories, not application-managed container paths. The runtime bind-mounts each document root and only the required Vhostra-managed host locations into disposable containers.

The typed storage layout is platform-aware: Electron provides the platform's application-data root for macOS, Windows, or Linux, and the layout derives Vhostra paths from that input. The code does not assume a macOS-only path. Persistent locations include:

- Vhostra settings; site definitions; and neutral virtual-host definitions
- source, imported, custom, and generated configuration
- Apache, Nginx, OpenLiteSpeed, PHP/php.ini, MariaDB, phpMyAdmin, Redis, and Memcached configuration
- public certificates and separately protected private keys
- MariaDB persistent data, logs, backups/snapshots, and configuration exports
- screenshot cache files associated with site definitions

The implemented store persists settings in `settings.json`, plus one site definition and neutral vhost definition per JSON file. Deleting a site removes only those definition files; it never removes the selected document root. Container removal, replacement, or a later runtime switch must not remove website content, databases, settings, vhost definitions, configuration files, certificates, or persistent logs.

The built-in localhost definition is intentionally protected from normal deletion in the desktop UI and store. Its host-side root and generated welcome-page files remain inspectable.

### Configuration ownership

Vhostra distinguishes three configuration layers:

1. **Vhostra source configuration** — the portable source of truth: settings, sites, and neutral vhosts.
2. **User-editable/custom configuration** — explicit additions owned by the user and never silently overwritten.
3. **Generated runtime configuration** — inspectable Apache/Nginx/OpenLiteSpeed/PHP/service files rendered from source configuration for the selected runtime.

Changing the global server renders a new target-server configuration from the neutral vhost model. Imported directives that cannot be made portable are retained as preserved directives and/or reported with compatible, warning, or unsupported classifications.

## Configuration import, export, and recovery

The architecture defines a portable `vhostra/config-bundle` manifest with schema version `1`. The current Export Configuration action writes an all-configuration JSON bundle containing settings, site definitions, and neutral vhost definitions. Preview Import validates a selected bundle; Import Configuration creates a local backup, adds non-conflicting definitions, refreshes runtime configuration, and requests scoped hosts mappings. Individual-site/vhost/server/PHP/MariaDB/optional-service export scopes are represented in the model and planned for the export UI.

By default, a portable configuration bundle excludes website content, database contents, passwords/secrets, and private TLS keys. Those require separate, explicit backup/export behavior. Before a future import, migration, or important replacement, Vhostra will create a local restorable snapshot. Bundle import is deliberately preview-only today: no imported configuration is applied, replaced, or backed up yet.

## External browser and screenshots

Clicking a saved site URL, preview, or external-link button opens the validated `http` or `https` URL with the operating system's default browser via Electron's main-process `shell.openExternal` API. Websites are never opened in a Vhostra `BrowserWindow`; the renderer remains isolated with `contextIsolation` enabled and `nodeIntegration` disabled.

Dashboard previews use a screenshot only when a site's definition references a real supported image file in Vhostra's host-side screenshot cache. Otherwise, Vhostra shows an explicit no-preview fallback. Screenshot capture is not implemented yet; the model and cache location are ready for a later capture service without changing site records.

## Tray and application lifecycle

Vhostra creates a platform tray/menu-bar icon and keeps the application available after its primary window is hidden. Settings provides a persisted close-button policy: minimize to the tray (the default), quit while keeping the Vhostra runtime running, or stop only Vhostra-managed services and then quit. The tray and Settings each provide the two explicit quit actions: **Quit Vhostra, Keep Services Running** and **Quit Vhostra and Stop Services**.

Start, Stop, and Restart actions—including individual active-web-server, MariaDB, Redis, and Memcached controls when the runtime supports them—use the same Vhostra-only runtime controller in the Dashboard, Services workspace, tray, and CLI. They operate only against the generated `vhostra` project and never target unrelated Docker resources.

## Bind mounts

Docker configuration uses explicit host-to-container mount plans. Host paths and container paths are separate typed values. Document roots, generated runtime configuration, persistent database data, certificates, and persistent logs can be mounted according to their purpose and access mode. Containers remain disposable runtime infrastructure; they are never the sole owner of user data.

## Docker isolation and safety principles

The Docker layer uses the dedicated `vhostra` Compose project, `com.vhostra.managed=true` labels, and `vhostra-network`. It invokes Compose only against Vhostra's generated project file; it never uses global cleanup or broad Docker stop/remove operations. Website roots, generated configuration, database data, logs, certificates, and service configuration are host bind mounts. A running server/PHP change checks a candidate against an isolated database copy and temporary ports, then promotes the selected configuration and health-checks localhost and phpMyAdmin. Failed promotion restores the verified previous configuration and image. If recovery fails, Vhostra retains recovery files and reports their location.

Security configuration for generated runtimes includes `expose_php=Off` and web-server response version hiding where supported.

## Planned vhost import and conversion

Virtual hosts are represented by a neutral internal model supporting custom hostnames and aliases, document roots, HTTPS, redirects, rewrites, headers, and logs. Planned import behavior is:

1. Import Apache, Nginx, or OpenLiteSpeed configuration into the neutral Vhostra model.
2. Generate equivalent configuration for the currently selected web server.
3. On a later global server change, regenerate selected-server configuration from the same model.
4. Report directives as compatible, warning, or unsupported; unsupported settings will not be silently discarded.

## System requirements and prerequisites

- Node.js 20 or newer (development)
- npm 10 or newer (development)
- Docker Desktop or a compatible Docker/Compose installation for runtime management
- macOS, Windows, or a supported Linux distribution

## Installation and development

```bash
npm install
npm run dev
```

`npm run dev` starts Vite and opens Electron. For browser-only interface development, use:

```bash
npm run dev:web
```

The Vite development UI binds to `127.0.0.1:9000`; it is separate from Vhostra's real localhost web-server port and phpMyAdmin port 9080.

## Build and validation

```bash
npm run typecheck
npm run build
```

The build compiles the React renderer and Electron main process. Packaging installers is not configured in this first iteration.

## Project structure

```text
electron/          Electron main-process entry point
  store.ts          Persistent settings, sites, vhosts, bundle, and screenshot-cache store
  preload.ts        Narrow IPC bridge for renderer actions
src/
  assets/          Derived logo, favicon, and application icon assets
  components/      Reusable renderer components (reserved for growth)
  types/           Environment, vhost, desktop bridge, local storage, and portable bundle models
  App.tsx          Application shell and persisted-site/dashboard UI
  welcome/         Static localhost welcome-page source
  styles.css       Tailwind entry point and small global rules
build/             Native app and tray packaging assets
  icon.icns         macOS application icon derived from the source artwork
  icon.ico          Windows application icon derived from the source artwork
  icons/            Linux PNG icon sizes derived from the source artwork
logo/logos.png     Authoritative user-supplied branding source
test/               Persistent-store and URL-safety tests
```

## Current limitations

Vhostra can request elevation to create/remove only its own marked hosts-file mappings for sites and aliases. It does not yet capture screenshots, parse arbitrary server configuration or restore arbitrary external backups. Configuration imports create a local backup, and configuration migration retains the source until destination health checks succeed. A cancelled elevation request leaves the site definition intact but reports that the hostname could not be mapped.

## PHP extensions and cwebp

The PHP screen reports the selected LSPHP package catalog from the running Vhostra image and distinguishes required modules, installed/enabled modules, selected modules awaiting a rebuild, and packages available for installation. Core MariaDB modules cannot be disabled. Redis and Memcached PHP modules are dependency-managed when their corresponding Vhostra service is enabled.

Changing an optional extension, OPcache, or `cwebp` preference persists the desired state and rebuilds only the Vhostra runtime when it is currently running. The candidate image fails with an explicit package error if an extension is not offered for the selected LSPHP version. `cwebp` defaults to enabled and is provided by Debian/Ubuntu’s `webp` package inside the disposable runtime image.

## Startup

Settings can register Vhostra at login. macOS and Windows use Electron’s native login-item support; Linux writes only Vhostra’s own XDG autostart desktop entry. The separate “Start configured services when Vhostra opens” setting starts only the Vhostra-managed runtime and respects the persisted Redis/Memcached selections.

## Local configuration path and logs

Settings shows Vhostra's active local configuration path and can move it to an
empty destination. Vhostra stops only its own runtime writers, copies its
settings, generated configuration, certificates, logs, backups, and MariaDB
data, verifies the copied settings, atomically switches its local pointer, and
only then removes the prior Vhostra-owned copy. It never moves external site
document roots or unrelated Docker data.

The Logs page reads persistent host-side logs incrementally: it lists a bounded
set of files and loads at most the newest 64 KiB of one selected file into the
renderer. This avoids retaining huge log files in Electron memory.

## Tray component controls

When the single Vhostra runtime is running, the tray obtains actual Supervisor
state for the active web server, MariaDB, and enabled Redis/Memcached services.
It exposes only meaningful Start, Stop, and Restart actions for those
Vhostra-managed processes. PHP/LSPHP remains controlled by its active web
server rather than being represented as a misleading separate generic-PHP
container or tray process.

## Terminal commands

Vhostra also exposes the same local runtime controller through its CLI. From a
development checkout, use `npm run cli -- …`; after installation the package
provides the `vhostra` command. The CLI never uses global Docker cleanup and
only invokes Vhostra's generated, labeled Compose project.

```bash
vhostra status
vhostra runtime status
vhostra runtime start
vhostra runtime stop
vhostra runtime restart
vhostra service list
vhostra service web restart
vhostra service mariadb restart
vhostra service redis stop
vhostra service redis enable
vhostra service memcached disable

vhostra php extensions list
vhostra php extension enable imagick
vhostra php extension disable imagick
vhostra opcache status
vhostra opcache enable
vhostra cwebp status
vhostra cwebp disable
vhostra redis status
vhostra redis enable
vhostra memcached restart
```

Commands return non-zero for invalid syntax, unavailable Docker, failed health
checks, or failed runtime operations. `VHOSTRA_USER_DATA` may be set only when
the desktop app uses a non-default Electron user-data directory. Hosts-file
updates remain a desktop UI operation because they require a scoped native
administrator prompt; the CLI does not bypass that privilege boundary.

Opt-in runtime acceptance checks use dedicated temporary Docker project, network,
image, configuration, database, and port scopes. They never migrate the live
user-data directory:

```sh
node test/migration-runtime.mjs
node test/servers-runtime.mjs
env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron test/tray.electron.mjs
```

Build the Electron output before running these checks. The tray harness is a
native macOS check. Runtime checks require Docker and remove their own test
containers and networks when finished.

When the configured HTTPS port is available, the managed runtime creates a local
self-signed certificate for localhost and the configured site names, and serves
HTTPS through its own TLS gateway. Keys stay in the local private certificate
directory. Vhostra does not change system certificate trust; browsers require
user-managed trust for these local certificates. An occupied HTTPS port disables
only the TLS listener and reports its owner while HTTP continues.

Apache and Nginx now handle the selected public HTTP listener inside the same
runtime. PHP requests use the selected LSPHP backend over an internal listener.
Apache applies .htaccess rewrite rules; Nginx uses the generated front-controller
routing and does not execute arbitrary .htaccess directives.

Startup validation covers Linux XDG entry creation/removal and executable quoting,
and macOS/Windows native API settings plus refusal feedback. Native login launch
on Windows/Linux and macOS login approval remain release acceptance checks on
those systems; this development Mac denied login-item registration. Automatic
runtime startup failures appear in a native error dialog.

Linux startup quoting follows the [Desktop Entry specification](https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html). Native login settings use the matching registration arguments when verifying acceptance, as required by [Electron](https://www.electronjs.org/docs/latest/api/app#appgetloginitemsettingsoptions-macos-windows).


Runtime operation details are available through **Expand runtime details** only
while backend work is active. Docker build/start/stop output, candidate validation,
health stages and configuration migration stages are streamed from real work.
The panel uses bundled Roboto Mono, keeps a bounded live buffer, preserves
scroll-back, and offers Follow latest output. Credentials and private material
are redacted before the desktop bridge; completed output belongs in ordinary
logs rather than a permanent runtime terminal.

Repeated desktop launches hand off to Electron's single session owner, restoring
and focusing its existing window. Port checks recognize the exact labeled
Compose project, runtime service, project directory and published bindings;
Vhostra's own ports are not external startup conflicts.

Hosts changes preserve unrelated records and formatting, compare the source
again before writing, create a protected adjacent `.vhostra-<id>.bak` recovery
copy, and replace the file atomically. Repair all mappings uses one write.
Renaming verifies new mappings before removing obsolete owned names. Windows
uses a narrowly elevated encoded PowerShell child with verified exit status;
macOS uses osascript and Linux pkexec. Native Windows/Linux prompts and approved
macOS hosts/login acceptance remain platform acceptance checks.

Additional opt-in acceptance scripts (after `npm run build`):

```sh
node test/extensions-runtime.mjs
node test/live-owned-ports.mjs  # read-only current macOS profile check
# Supply an isolated existing temporary directory for these native app harnesses:
env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron test/session.electron.mjs --session-root=/private/tmp/vhostra-session-test
env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron test/terminal.electron.mjs
env -u ELECTRON_RUN_AS_NODE node_modules/.bin/electron test/migration-progress.electron.mjs --profile=/private/tmp/vhostra-migration-profile
```

The session/migration harnesses remove only their explicitly supplied test
profiles. Never pass a real user-data directory to them. Full audit evidence is
recorded in `VHOSTRA_FUNCTIONAL_AUDIT.md`.
