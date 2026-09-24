# Vhostra

Vhostra is a lightweight, cross-platform graphical local PHP development environment. It is designed around one shared runtime: many local websites use one selected web server, one selected PHP version, and shared supporting services.

> Development status: the Electron shell, navigation, dashboard mocks, local-first storage/configuration models, export/import bundle models, and Settings/Logs placeholders are implemented. Docker orchestration, filesystem persistence operations, server switching, vhost parsing/conversion, and database operations are planned and intentionally inactive.

## Features

- Electron desktop application for macOS, Windows, and Linux
- React, TypeScript, Vite, and Tailwind CSS interface
- Responsive, collapsible navigation for Dashboard, Sites, Virtual Hosts, Database, phpMyAdmin, Server, PHP, Services, Logs, and Settings
- Dashboard mock data that illustrates one shared local environment
- Typed, server-neutral virtual-host model ready for future import/conversion work
- Typed local-first storage layout, configuration ownership, snapshot, and portable bundle models
- Settings export/import entry points and persistent Logs UI placeholders
- Authoritative branding assets derived directly from `logo/logos.png`

## Architecture summary

Vhostra will run exactly one global web server and exactly one global PHP runtime at a time. Websites are vhosts within that shared environment—not individual stacks. MariaDB and phpMyAdmin are required shared services; Redis and Memcached are optional shared services.

Supported web servers (planned runtime support): Apache, Nginx, and OpenLiteSpeed.

Supported PHP versions (planned runtime support): PHP 8.1, 8.2, 8.3, 8.4, and 8.5.

## Local-first storage and persistence

Vhostra is designed so irreplaceable data stays on the host computer. Website document roots are normal user-selected or user-created host directories, not application-managed container paths. The future runtime will bind-mount each document root and only the required Vhostra-managed host locations into disposable containers.

The typed storage layout is platform-aware: an Electron platform adapter will provide the platform's application-data root for macOS, Windows, or Linux, and the layout derives Vhostra paths from that input. The code does not assume a macOS-only path. Planned persistent locations include:

- Vhostra settings; site definitions; and neutral virtual-host definitions
- source, imported, custom, and generated configuration
- Apache, Nginx, OpenLiteSpeed, PHP/php.ini, MariaDB, phpMyAdmin, Redis, and Memcached configuration
- public certificates and separately protected private keys
- MariaDB persistent data, logs, backups/snapshots, and configuration exports

Container removal, replacement, or a later runtime switch must not remove website content, databases, settings, vhost definitions, configuration files, certificates, or persistent logs.

### Configuration ownership

Vhostra will distinguish three layers rather than merging them silently:

1. **Vhostra source configuration** — the portable source of truth: settings, sites, and neutral vhosts.
2. **User-editable/custom configuration** — explicit additions owned by the user and never silently overwritten.
3. **Generated runtime configuration** — inspectable Apache/Nginx/OpenLiteSpeed/PHP/service files rendered from source configuration for the selected runtime.

Changing the global server will render a new target-server configuration from the neutral vhost model. Imported directives that cannot be made portable are retained as preserved directives and/or reported with compatible, warning, or unsupported classifications.

## Configuration import, export, and recovery

The architecture defines a portable `vhostra/config-bundle` manifest with schema version `1`. It can represent exports of all configuration, an individual site or virtual host, server configuration, PHP configuration, MariaDB configuration, or optional Redis/Memcached configuration.

By default, a portable configuration bundle excludes website content, database contents, passwords/secrets, and private TLS keys. Those require separate, explicit backup/export behavior. Before a future import, migration, or important replacement, Vhostra will create a local restorable snapshot. The current Settings actions and manifest preview are UI/model placeholders; no files are exported, imported, backed up, or replaced yet.

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
src/
  assets/          Derived logo, favicon, and application icon assets
  components/      Reusable renderer components (reserved for growth)
  data/            Mock presentation data
  types/           Environment, vhost, local storage, and portable bundle models
  App.tsx          Application shell and dashboard
  styles.css       Tailwind entry point and small global rules
build/             App icon used by Electron packaging later
logo/logos.png     Authoritative user-supplied branding source
```

## Limitations in this iteration

The interface presents mock runtime data and local-first configuration placeholders only. It does not yet write host storage, create snapshots, select files, export/import bundles, install/start/stop/replace Docker containers, inspect ports, generate Compose files, modify hosts files, operate MariaDB/phpMyAdmin, parse/render server configuration, or switch PHP/web-server implementations.
