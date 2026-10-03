# Third-Party Notices

Vhostra includes or uses third-party software and assets. Those components remain subject to their respective licenses and copyright terms. This document does not select a license for Vhostra itself. No Vhostra `LICENSE` is supplied.

Audit date: 2026-09-29. Evidence: `package.json`, all 169 non-root entries in `package-lock.json`, installed npm license/notice files, Electron's downloaded distribution, both Dockerfiles, running Vhostra container package/copyright records, font name tables, local assets, service attribution, `DESIGN.md`, and authoritative sources linked below. Copyright statements are preserved in the accompanying original license files; omitted authors are not inferred.

## Runtime / Application Components

| Component | Locked version / role | Verified license and notice evidence |
| --- | --- | --- |
| Electron | 44.4.5; desktop runtime (npm dev flag does not mean development-only) | MIT; Electron contributors. [Original distribution license](third-party-licenses/Electron-LICENSE.txt). Chromium, Node.js and other included projects have separate terms in [the distribution's complete notices](third-party-licenses/Electron-Chromium-LICENSES.html.gz), a lossless gzip copy; decompress to HTML for reading. |
| React / React DOM | 18.3.1; renderer and welcome-page bundle | MIT; Facebook, Inc. and affiliates. Full notices in [React](third-party-licenses/npm/node_modules__react/LICENSE) and [React DOM](third-party-licenses/npm/node_modules__react-dom/LICENSE). |
| Scheduler / loose-envify | 0.23.2 / 1.4.0; React dependency chain | Installed MIT notices retained in the npm inventory. Exact final bundler inclusion depends on production tree shaking. |
| Lucide React | 0.468.0; bundled interface SVG icons | ISC. Copyright for Lucide contributors and the Feather-derived portions credited to Cole Bemis is preserved in [the actual package license](third-party-licenses/npm/node_modules__lucide-react/LICENSE). Retain that entire notice. |

MIT/ISC components require their notices to accompany redistributed copies covered by their terms. Keep the complete Electron component-specific notices, including any distinct conditions recorded there; Electron's MIT license alone does not replace them.

The authoritative per-package inventory is [NPM_INVENTORY.md](third-party-licenses/NPM_INVENTORY.md); [machine-readable evidence](third-party-licenses/npm-inventory.json) records declared licenses, source repositories when present, installed material and SHA-256 hashes. Run `node scripts/audit-third-party.mjs` after dependency changes. Package-manager metadata is a declaration, not a substitute for each distributed artifact's license files.

## Docker / Server Components

The repository ships Docker build recipes and local runtime scripts. They download `litespeedtech/openlitespeed:latest`, `mariadb:${MARIADB_SERIES}` (default 11.8), distribution packages and phpMyAdmin 5.2.2. These images are composed of many separately licensed components; an image name has no single blanket license. Mutable tags/package repositories mean these inspected versions are a snapshot, not a guarantee of future builds. Docker Desktop is a separately installed prerequisite, not a bundled Vhostra component.

[Web package inventory](third-party-licenses/docker/web-packages.tsv), [MariaDB package inventory](third-party-licenses/docker/mariadb-packages.tsv), retained per-package copyright files under `third-party-licenses/docker/web/` and `mariadb/`, and [complete common license texts](third-party-licenses/docker/common/) preserve the actual inspected image evidence. Packaging retains these license records. Collect them again for each exact image/platform before distributing binaries or images.

| Component | Inspected version / role | Verified terms / evidence |
| --- | --- | --- |
| OpenLiteSpeed | Included in the LiteSpeed base image; selected HTTP/TLS server | GPL version 3 text in the installed manual and [official source LICENSE](third-party-licenses/upstream/OpenLiteSpeed-LICENSE.txt), from [upstream](https://github.com/litespeedtech/openlitespeed/blob/master/LICENSE). Installed documentation credits LiteSpeed Technologies Inc.; see [installed license page](third-party-licenses/docker/OpenLiteSpeed-license.html). Verify exact binary source revision before redistribution. |
| MariaDB | 11.8.9 in inspected independent image; persistent database service | Installed [server copyright](third-party-licenses/docker/mariadb/mariadb-server/copyright) records GPL v2 and component-specific exceptions. Preserve full package records; do not generalize the client exception to the whole image. |
| Apache HTTP Server | 2.4.66; selectable frontend | [Package copyright](third-party-licenses/docker/web/apache2/copyright): Apache-2.0 for main upstream work, Apache Software Foundation, with separately listed bundled works/packaging terms. Retain relevant NOTICE/attributions and modification notices. |
| Nginx | 1.28.3; selectable frontend | [Package copyright](third-party-licenses/docker/web/nginx/copyright): BSD-2-clause for principal upstream code, with other listed works. Preserve copyright, conditions and disclaimer. |
| PHP / LSPHP | Selected 8.5.10 plus base-image 8.2.33; supported build choices 8.1–8.5 | Official PHP 8.5.10 [PHP License 3.01](third-party-licenses/docker/PHP-LICENSE.txt), The PHP Group, from [exact upstream tag](https://github.com/php/php-src/blob/php-8.5.10/LICENSE). LSPHP package/binary patch provenance still needs verification. Extensions have independent terms; retained APCu, phpredis, memcached, igbinary, msgpack and ImageMagick records must be reviewed for the selected build. |
| Redis | 8.0.5 in inspected image; optional cache | Actual [package copyright](third-party-licenses/docker/web/redis-server/copyright) declares choice of RSALv2, SSPLv1 or AGPLv3 for principal code, plus independently licensed portions. **Do not assume the older Redis BSD license applies to this image.** Select and document the applicable route and satisfy its conditions before image distribution. No legal compatibility conclusion is made here. |
| Memcached | 1.6.40; optional cache | [Package copyright](third-party-licenses/docker/web/memcached/copyright): principal work BSD-3-clause, Danga Interactive; Debian packaging has separate terms. |
| phpMyAdmin | Dockerfile pins 5.2.2; local database UI | Original [GPL v2 license](third-party-licenses/docker/phpMyAdmin-LICENSE.txt) copied from the installed application. Its third-party vendor/frontend assets need an exact release archive inventory before redistribution. |
| cwebp / libwebp | webp package 1.5.0; optional local tool | [Actual package copyright](third-party-licenses/docker/web/webp/copyright): BSD-3-Clause, Google Inc., additional authors and separate bundled terms. |
| Supervisor, socat, logrotate, OpenSSL, curl, CA certificates and distribution libraries/tools | Runtime support and base-image contents | Per-package license/copyright records and common license texts are retained, including Supervisor's BSD-derived terms and socat's GPL/OpenSSL exception. Consult the actual file-level records rather than assuming all support packages have the server's license. |
| LiteSpeed Enterprise | Configuration import compatibility only | Vhostra parses supported virtual-host configuration text into its canonical Site model, from which Apache, Nginx, or OpenLiteSpeed configuration can be generated. Vhostra does not use, bundle, install, start, or distribute the Enterprise server. Rights in proprietary configuration syntax, if applicable to a particular source, require separate verification; no Enterprise licensing terms are asserted here. |

Required PHP acknowledgment: “This product includes PHP software, freely available from <http://www.php.net/software/>”. This acknowledgment comes from the retained PHP license. PHP naming/endorsement restrictions remain applicable.

Redis choice, GPL/AGPL/LGPL components, native-image dependencies, modified upstream configuration and any redistribution of server images require an explicit distribution/source plan. Preserve corresponding source, build scripts, notices and modification records where the applicable license requires them. Supplying these notices alone does not establish source-delivery compliance, and generic upstream links are not asserted to satisfy it. Source archives/written offers have not been prepared in this phase.

## Fonts

All fonts are local files loaded by `src/styles.css` and the welcome page; there are no production Google Fonts requests.

| Files | Embedded evidence | Verified upstream terms |
| --- | --- | --- |
| `roboto-400.ttf`, `roboto-500.ttf`, `roboto-700.ttf` | Roboto / Roboto Medium, version 3.015; 2026; copyright 2011 The Roboto Project Authors; embedded source `googlefonts/roboto-classic` and Open Font License URL | [Official Roboto Classic OFL](https://github.com/googlefonts/roboto-classic/blob/main/OFL.txt); full [copyright and SIL OFL 1.1](third-party-licenses/upstream/Roboto-OFL.txt). These are not assumed to be older Apache-licensed Roboto 2 files. |
| `roboto-mono-400.ttf` | Roboto Mono version 3.001; copyright 2015 The Roboto Mono Project Authors; embedded source `googlefonts/robotomono` and Open Font License URL | [Official Roboto Mono OFL](https://github.com/googlefonts/RobotoMono/blob/main/OFL.txt); full [copyright and SIL OFL 1.1](third-party-licenses/upstream/RobotoMono-OFL.txt). |

OFL notices accompany the fonts. Keep the fonts under their own license; heed standalone-sale, attribution, naming and modification conditions. Repository download/conversion history is absent: establish exact release-file hashes and whether these static files were converted/subsetted before public distribution. The metadata matches the identified upstream families, but this is not a claim of a verified original-download chain.

## Icons and Visual Assets

Sources recorded by the repository are in [service attribution](src/assets/services/ATTRIBUTION.md). Interface icons are Lucide React as above. Bundled service marks are descriptive third-party marks; copyright permission and trademark/branding conditions must be considered separately.

| Asset | Evidence and status |
| --- | --- |
| MariaDB, Redis, Memcached SVG marks | Repository attribution identifies Devicon originals. [Verified Devicon MIT notice](third-party-licenses/upstream/Devicon-LICENSE.txt), copyright 2015 konpa, from [official repository](https://github.com/devicons/devicon/blob/master/LICENSE), accompanies these assets. MariaDB uses a CSS light silhouette in dark mode; the SVG file is unchanged in this phase. Devicon's license does not establish unrestricted trademark rights. |
| PHP `php.svg` | Attribution identifies `new-php-logo.svg` from [PHP's logo page](https://www.php.net/download-logos.php). The official page credits Colin Viebrock and declares CC BY-SA 4.0 for the principal PHP logo. Credit Colin Viebrock, link [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), and identify changes. No file change was made in this phase; exact source equality and any historical adaptation need verification. |
| OpenLiteSpeed PNG | Official [branding page](https://openlitespeed.org/branding/) asks to preserve original format/colors and obtain approval for promotional use. The repository contains no approval record. Verify scope/permission before public distribution; GPL software licensing does not itself resolve mark rights. |
| Apache feather GIF, Nginx favicon, phpMyAdmin favicon | Repository supplies official project source URLs. Exact asset-specific license/notice and mark usage permission are not established by that provenance alone. Listed below for verification. |
| Vhostra logo variants, app/tray/platform icons, `brand-source.png` | Local raster originals/derivatives and a native icon-generation script exist. No creator/source/rights record establishes whether the source art is user-created, generated, licensed or adapted. Rights are not invented. |

## Design References / Assets

`DESIGN.md` retains Red Broadcast prose, colors, typography and component guidance, with an additional Vhostra desktop adaptation. This is more than a bare external link: the repository contains adapted reference text. The authoritative [Red Broadcast page](https://designmd.ai/chef/red-broadcast), uploader `Chef @chef`, currently labels its v1 design **MIT**. [DesignMD's terms](https://designmd.ai/terms) distinguish uploader-selected design-system licenses from the platform's own name/logo/site rights.

The original complete MIT copyright/permission notice for this particular uploaded design was not recovered from repository evidence or its download endpoint. Record the verified MIT label without inventing a copyright holder/year or silently applying a generic MIT notice. Obtain and retain the original notice before distributing copied/adapted reference prose. No evidence was found of a bundled Red Broadcast mockup or DesignMD platform logo; local Vhostra raster provenance remains separately unresolved. This does not license Vhostra itself as MIT.

## Development Dependencies

Vite 6.4.3, TypeScript 5.9.3, Tailwind CSS 4.3.3, `@tailwindcss/vite`, `@vitejs/plugin-react`, Babel/esbuild/Rollup tooling and type declarations are inventoried with their complete installed notices. Vite/plugins occur in `dependencies` rather than `devDependencies`; therefore a packager installing all production dependencies may also ship them. Review the final package instead of assuming they disappear. Tailwind-generated CSS and any retained bundled helper code still need the relevant notices. TypeScript's actual Apache-2.0 material and any upstream NOTICE are retained. Platform-specific optional native packages unavailable on this Mac are marked for release-platform verification rather than guessed from a package name.

`@electron-internal/extract-zip` 1.0.5 declares BSD-2-Clause but its installed package lacks a root license file. Obtain its exact-version copyright/license material if this tooling or its binary is distributed. No nondependency copied third-party application code was identified beyond the documented design text/assets and runtime component integration; absent provenance records prevent an exhaustive authorship guarantee.

## Items Requiring License Verification

Before public distribution:

1. Recover Red Broadcast v1's original MIT notice; verify the adapted `DESIGN.md` retains the required original notice.
2. Establish source/rights for Vhostra raster artwork and exact service icon files; obtain or document any required branding approval. Verify PHP CC BY-SA attribution/change history and asset identity; retain exact mark-specific notices for Apache/Nginx/phpMyAdmin.
3. Verify bundled font release hashes and conversion/subsetting history; retain OFL notices and honor any applicable naming conditions.
4. Freeze actual image digests/package versions, collect licenses/NOTICE/vendor assets for each released architecture, and identify exact OLS/LSPHP source/patches. The changing `latest` image and apt repositories prevent a permanent version-independent audit.
5. Select/document the Redis 8 licensing route and prepare any required corresponding source/build/modification or offer materials for redistributed GPL/AGPL/LGPL/server components. This audit does not supply those source artifacts or choose a license for Vhostra.
6. Obtain missing exact-version/platform npm notices and inspect final Electron/package contents; preserve all relevant Chromium/Node notices. Verify that packaging retains this notice folder and complete license content on every release platform.
7. Verify any rights relevant to importing proprietary Enterprise configuration syntax before distributing support for such sources; no Enterprise server binary is included.

Additional third-party license files were necessary and are supplied under `third-party-licenses/`; original text was copied from installed distributions or the identified authoritative upstream source, not written from memory. The desktop packaging manifest lists this document and the notice directory as extra resources; final artifact inclusion remains to be verified. Large Chromium notices are losslessly compressed to avoid duplicating ~20 MiB of uncompressed legal HTML. This is an evidence-based inventory with explicit unresolved items, not a declaration that distribution is legally cleared.
Docker is not bundled by the native Vhostra installer. A user who elects to install Docker is directed to Docker's official instructions and completes Docker's own distribution process separately. Vhostra does not accept Docker's terms for the user or remove Docker on uninstall.

The Linux package `after-install.sh` and `after-remove.sh` retain electron-builder 26.15.3 `app-builder-lib` Linux hook templates with Vhostra CLI-link additions. The upstream project is MIT-licensed; its [license](third-party-licenses/electron-builder/LICENSE) is retained with the package scripts.
