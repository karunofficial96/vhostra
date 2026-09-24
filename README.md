# Vhostra

Vhostra is a lightweight, cross-platform graphical local PHP development environment. It is designed around one shared runtime: many local websites use one selected web server, one selected PHP version, and shared supporting services.

> Development status: Vhostra now persists settings and site/neutral-vhost definitions locally, supports add/edit/remove site definitions, host directory selection, external-browser opening, configuration bundle export, and import-bundle validation. Docker orchestration, runtime installation/start/stop, applied configuration imports, vhost parsing/conversion, screenshot capture, and database operations remain planned and inactive.

## Features

- Electron desktop application for macOS, Windows, and Linux
- React, TypeScript, Vite, and Tailwind CSS interface
- Responsive, collapsible navigation for Dashboard, Sites, Virtual Hosts, Database, phpMyAdmin, Server, PHP, Services, Logs, and Settings
- Dashboard backed by real saved site definitions, with no simulated runtime status
- Add, edit, and remove site definitions without changing document-root files
- Native document-root folder selection and secure OS-default browser opening for local site URLs
- Persisted selected web server, PHP version, and Redis/Memcached preferences
- Configuration bundle export and import-bundle validation preview
- Typed, server-neutral virtual-host model ready for future import/conversion work
- Typed local-first storage layout, configuration ownership, snapshot, and portable bundle models
- Exact-source macOS, Windows, Linux, window, and favicon application icons
- Authoritative branding assets derived directly from `logo/logos.png`

## Architecture summary

Vhostra will run exactly one global web server and exactly one global PHP runtime at a time. Websites are vhosts within that shared environment—not individual stacks. MariaDB and phpMyAdmin are required shared services; Redis and Memcached are optional shared services.

Supported web servers (planned runtime support): Apache, Nginx, and OpenLiteSpeed.

Supported PHP versions (planned runtime support): PHP 8.1, 8.2, 8.3, 8.4, and 8.5.

## Local-first storage and persistence

Vhostra keeps its application data in Electron's platform-specific `userData` location, under a `Vhostra` directory. Website document roots are normal user-selected or user-created host directories, not application-managed container paths. The future runtime will bind-mount each document root and only the required Vhostra-managed host locations into disposable containers.

The typed storage layout is platform-aware: an Electron platform adapter will provide the platform's application-data root for macOS, Windows, or Linux, and the layout derives Vhostra paths from that input. The code does not assume a macOS-only path. Planned persistent locations include:

- Vhostra settings; site definitions; and neutral virtual-host definitions
- source, imported, custom, and generated configuration
- Apache, Nginx, OpenLiteSpeed, PHP/php.ini, MariaDB, phpMyAdmin, Redis, and Memcached configuration
- public certificates and separately protected private keys
- MariaDB persistent data, logs, backups/snapshots, and configuration exports
- screenshot cache files associated with site definitions

The implemented store persists settings in `settings.json`, plus one site definition and neutral vhost definition per JSON file. Deleting a site removes only those definition files; it never removes the selected document root. Container removal, replacement, or a later runtime switch must not remove website content, databases, settings, vhost definitions, configuration files, certificates, or persistent logs.

### Configuration ownership

Vhostra will distinguish three layers rather than merging them silently:

1. **Vhostra source configuration** — the portable source of truth: settings, sites, and neutral vhosts.
2. **User-editable/custom configuration** — explicit additions owned by the user and never silently overwritten.
3. **Generated runtime configuration** — inspectable Apache/Nginx/OpenLiteSpeed/PHP/service files rendered from source configuration for the selected runtime.

Changing the global server will render a new target-server configuration from the neutral vhost model. Imported directives that cannot be made portable are retained as preserved directives and/or reported with compatible, warning, or unsupported classifications.

## Configuration import, export, and recovery

The architecture defines a portable `vhostra/config-bundle` manifest with schema version `1`. The current Export Configuration action writes an all-configuration JSON bundle containing settings, site definitions, and neutral vhost definitions. The current Preview Import action validates a selected bundle without applying it. Individual-site/vhost/server/PHP/MariaDB/optional-service export scopes are represented in the model and planned for the export UI.

By default, a portable configuration bundle excludes website content, database contents, passwords/secrets, and private TLS keys. Those require separate, explicit backup/export behavior. Before a future import, migration, or important replacement, Vhostra will create a local restorable snapshot. Bundle import is deliberately preview-only today: no imported configuration is applied, replaced, or backed up yet.

## External browser and screenshots

Clicking a saved site URL, preview, or external-link button opens the validated `http` or `https` URL with the operating system's default browser via Electron's main-process `shell.openExternal` API. Websites are never opened in a Vhostra `BrowserWindow`; the renderer remains isolated with `contextIsolation` enabled and `nodeIntegration` disabled.

Dashboard previews use a screenshot only when a site's definition references a real supported image file in Vhostra's host-side screenshot cache. Otherwise, Vhostra shows an explicit no-preview fallback. Screenshot capture is not implemented yet; the model and cache location are ready for a later capture service without changing site records.

## Bind mounts

Future Docker configuration will use explicit host-to-container mount plans. Host paths and container paths are separate typed values. Document roots, generated runtime configuration, persistent database data, certificates, and persistent logs can be mounted according to their purpose and access mode. Containers remain disposable runtime infrastructure; they are never the sole owner of user data.

## Docker isolation and safety principles

The future Docker layer will use a dedicated Compose project, labels, network, named resource conventions, and host bind mounts. It will only inspect or change resources owned by Vhostra. It will not stop or remove unrelated containers, modify unrelated networks/volumes/images, run global cleanup, or download all web-server images. Before changing a server or PHP version, it will create a local configuration snapshot, prepare and validate the replacement, preserve persistent data and sites, remove only obsolete Vhostra runtime containers, start the selected runtime, and health-check it. Port conflicts will be detected without stopping another application.

Security configuration planned for generated runtimes includes `expose_php=Off` and web-server response version hiding where supported.

## Planned vhost import and conversion

Virtual hosts are represented by a neutral internal model supporting custom hostnames and aliases, document roots, HTTPS, redirects, rewrites, headers, and logs. Planned import behavior is:

1. Import Apache, Nginx, or OpenLiteSpeed configuration into the neutral Vhostra model.
2. Generate equivalent configuration for the currently selected web server.
3. On a later global server change, regenerate selected-server configuration from the same model.
4. Report directives as compatible, warning, or unsupported; unsupported settings will not be silently discarded.

## System requirements and prerequisites

- Node.js 20 or newer (development)
- npm 10 or newer (development)
- Docker Desktop or a compatible Docker/Compose installation will be required when runtime management is implemented
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
  styles.css       Tailwind entry point and small global rules
build/             App icon used by Electron packaging later
  icon.icns         macOS application icon derived from the source artwork
  icon.ico          Windows application icon derived from the source artwork
  icons/            Linux PNG icon sizes derived from the source artwork
logo/logos.png     Authoritative user-supplied branding source
test/               Persistent-store and URL-safety tests
```

## Limitations in this iteration

Vhostra does not yet install, start, stop, or replace Docker containers; inspect ports; generate Compose files; modify hosts files; operate MariaDB/phpMyAdmin; capture site screenshots; parse/render server configuration; apply configuration imports; create recovery snapshots; or switch PHP/web-server implementations. The selected server/PHP/service values are persisted preferences only until runtime management is implemented.
