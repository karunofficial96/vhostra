# Backup reconciliation / desktop budgets (2026-09-29)

The independent persistent database architecture and historical performance budgets below remain in force. This phase adds no package/dependency or permanent window/process. Redis/Memcached stay inside web/PHP; disabled services have no daemon. No new timer scans Hosts, backups, databases, Site trees or tray visibility. Resources remains visible-only/cached; screenshots remain transient/local and remote-blocked.

- Hosts editor: maximum 1 MiB draft, 100 history entries and 8 MiB UTF-16 history budget; branch trimming and cleanup on save/cancel/reload/unmount. Previous unsaved draft is one bounded buffer. Review supports ≤16,384 lines and ≤128 KiB displayed diff; patience anchors avoid quadratic full-file LCS. Local 16,000-line/681,780-byte fixture with two separated edits: **16.26 ms**, 204-byte diff, two sections. This is one local algorithm sample, not a general UI latency guarantee.
- Recovery files: ten completed Hosts and full-database restore records. Uncertain/failed recovery stays intact; new operations stop when their own recovery class reaches 60 records. Verified unchanged Hosts cancellation removes its own unnecessary record. Existing configuration-import completed retention remains ten. No continuous retention worker.
- Backup preview: metadata ≤4 MiB, ≤500 Sites/databases/accounts; cache configs ≤64 KiB each. Only canonical/private account/cache metadata and fingerprints are read. No SQL dump or external Site tree scan on onboarding render. Explicit data comparison and selected Restore use streamed dumps/hashes, temporary equality dumps are deleted. Actual DB recovery dumps are user-triggered disk work, not copied live datadirs or retained renderer buffers.
- Progress: latest bounded 2,000-character backup event to visible UI; journals contain ≤bounded manifest item outcomes, not unbounded SQL/progress logs. Private auth/raw native source do not enter normal state/progress IPC.
- Tray: strongly retained Tray/NativeImage, event-driven visibility updates with cached service rows; coalesced asynchronous refresh cannot delay the Open item. No visibility polling. CSS/component text selection adds no global selection listener. Existing modal keyboard focus handling remains modal-only.

Sequential actual Docker acceptance and exact inventory cleanup passed in `/private/tmp/vhostra-reconciliation-live-final.log`; custom port/memory config survives real server/PHP replacement and caches-off means no daemon. This phase makes no new Electron idle RSS, startup time or Docker image reduction claim; earlier measurements below are historical samples. Bounded diff/retention/non-mutating identical-restore contracts are covered by the 94-test suite.

---

# Persistent database/runtime architecture update (2026-09-29)

Current architecture supersedes historical single-container claims below: one web/PHP runtime plus one purpose-built MariaDB image using the official matching-series base. Redis/Memcached remain optional processes in web/PHP; no extra cache containers. MariaDB data/config/logs are direct host bind mounts. Web/PHP candidates reuse the existing independent DB without stop/copy/duplicate-server work. Tiny socat listeners provide local TCP/socket compatibility; the DB-side socket gateway preserves localhost authentication semantics.

MariaDB remains conservative (64 MiB buffer pool, 50 connections, 16 MiB temporary tables, performance_schema off). DB error logs rotate at 5 MiB with three copies; Docker logs are 5 MiB × three. Screenshot capture uses one transient local Chromium window at a time, 1280×720 viewport reduced to 960×540 JPEG quality75, ≤1 MiB per Site. No screenshot idle timer, remote screenshot API, unbounded retry loop or full-page capture. Six requests maximum queue, ten-minute automatic failure cooldown, 24-hour freshness and explicit Refresh. Each preview window is destroyed and ephemeral-session storage/connections cleared after each attempt; one in-memory session is reused to avoid partition accumulation.

Resource polling remains visible-only; host/storage size scans remain cached five minutes and bounded, with DB data counted once. Current sequential sample (`/tmp/vhostra-persistent-controls.log`, Apache/PHP 8.4, intl/APCu, both cache services disabled, 15 seconds settling): Web/PHP 72.47 MiB / 0.04% CPU; MariaDB 126.4 MiB / 0.03% CPU, combined 198.87 MiB. No MariaDB/Redis/Memcached daemon was present in web/PHP; socat listeners were present. These are Docker idle samples, not peak-workload guarantees or a like-for-like improvement claim.

Current web image logical size: 1,130,278,297 bytes; DB image: 380,188,307 bytes. The DB image uses its purpose-built matching-series official base and does not duplicate the web/PHP image. Image totals include shared layers and are not exclusive disk usage. The Resources sample included 10,060,817,161 logical image bytes across Vhostra profiles/caches and 149,672 current writable-layer bytes; it excludes unrelated projects. Final retention keeps six newest web builds and two newest DB builds, plus referenced/recovery/unknown-tag images, without global prune. Host fixture DB bytes: 162,019,001 counted once; logs 15,060; runtime config/context 7,618; local total 220,415,919 excluding external roots. Five-minute cached/on-demand bounded scans remain unchanged.

Native preview fixture: 1280×720 capture → 960×540 JPEG (~11 KiB), not the 6,000px-long page; screenshot/protocol/privacy/fallback and cleanup verified in `/tmp/vhostra-persistent-ui7.log`. No idle capture timer or permanent screenshot window. Final expanded architecture has no newly claimed Electron idle RSS improvement; historical Electron measurements below are explicitly older evidence.

---

# Vhostra performance audit

Audit date: 2026-09-27. Machine: 16 GiB Apple Silicon Mac; Docker Desktop VM reports 8,227,332,096 bytes (7.662 GiB). Heavy Docker suites run sequentially, with temporary profiles, database directories, networks and ports. The actual user profile, website/database content, stopped Vhostra container, and SpeedClarity resources are not modified by the audit tests.

## Findings and the reported hang

The committed dev launcher had no automatic Electron restart/spawn loop. Electron initializes its store, IPC, tray and runtime manager only after obtaining its single-instance lock. Four Electron processes in these samples are normal: main, renderer, GPU and network utility. They are not four Vhostra applications.

The saved desktop profile has `startServicesOnLaunch: true`. Previously, both automatic startup and ordinary Start always invoked Compose `up --build`, even when a compatible image existed. Therefore `npm run dev` could launch a Docker build along with Vite and two TypeScript compilers. This is a plausible pressure spike, not a proven explanation of the earlier system hang: there are no diagnostics from that incident.

Other confirmed waste: the two identical compiler configurations each loaded Electron/Node types; every progress chunk synchronously rebuilt the tray twice; hidden windows received progress snapshots; disabled add-ons occupied `sleep` processes; OpenLiteSpeed used eight workers and an unused upstream demo PHP process group; HTTPS started an extra Nginx daemon; Apache/Nginx started OpenLiteSpeed as their PHP backend; generated database/cache configuration was not mounted; apt indexes remained in the image; candidates used separate scope-specific image tags and copied the database twice.

## Development diagnostics

Normal usage remains `npm run dev`. To collect local resource diagnostics:

```sh
VHOSTRA_RESOURCE_DEBUG=1 npm run dev
```

The first sample is after ten seconds, then every thirty seconds, after the preceding sample finishes. Output stays in the launching terminal. It contains Electron process types/count, RSS and CPU, main JS memory, visible/hidden state, runtime activity, retained progress lines, filesystem watcher count, Docker/Compose/refresh/build/operation counters, and one Docker stats sample for the exact labeled runtime project. There is no telemetry, upload or persistent sampling file. Packaged apps never start this diagnostic timer.

`VHOSTRA_DEV_PROFILE=/absolute/temporary/profile` isolates acceptance tests; ordinary development continues to use the saved desktop profile and startup/close preferences. Do not point test harnesses at your normal user-data directory.

The launcher now runs Vite, **one** TypeScript watcher for both main/preload, and one Electron application. It refuses a second session for the checkout before touching shared compiler output. Child process groups are terminated on Ctrl+C, startup cancellation, any critical child exit, and Electron exit, with a three-second termination fallback. Windows uses process-tree termination; native Windows lifecycle acceptance is still required. This cleanup does not stop Docker services or change the selected close policy.

## Measurements

RSS sums count shared pages more than once; they are not unique physical RAM. Docker stats memory differs from summing process RSS, and its PIDs column includes threads. CPU values below are the respective tools' reported percentages. These are idle samples after health checks, not promises about imports or peak workloads.

| Measurement | Before | After |
| --- | ---: | ---: |
| Electron compiler watchers | 2 | 1 |
| Compiler idle RSS total | 658.4 MiB | 350.2 MiB |
| Production-bundle Electron processes (unpackaged) | 4 | 4 |
| Production-bundle visible main RSS | 173.4 MiB | 174.9 MiB |
| Production-bundle visible renderer RSS | 116.9 MiB | 118.2 MiB |
| Production-bundle visible idle main CPU | 0.0022% | 0.0035% |
| OLS runtime memory, PHP 8.5/APCu, HTTPS | 269.4 MiB | 199.9 MiB |
| OLS runtime idle CPU sample | 0.71% | 0.08% |
| OLS web workers | 8 | 1 |
| Disabled add-on/backend placeholder processes | 3 | 0 |
| Extra TLS Nginx daemon in OLS mode | present | absent |
| Runtime image bytes, PHP 8.5/APCu | 1,431,472,121 | 1,388,362,776 |

Compiler samples use `ps`; Electron samples use `app.getAppMetrics()` and `process.memoryUsage()`. Electron memory stayed approximately flat: the audit does **not** claim an app-RAM reduction. Removing the redundant compiler avoided about 308 MiB of measured dev overhead. Runtime image reduction is about 41.1 MiB; inherited upstream image layers remain intact, and image sizes do not equal exclusive disk usage across shared Docker layers.

The initial post-change runtime samples without explicitly selecting APCu were OLS 224.6 MiB/0.05%, Apache 228.5 MiB/0.05%, and Nginx 199.6 MiB/0.07%. The subsequent APCu-selected pass measured OLS 211.2 MiB/0.15%, Apache 239.5 MiB/0.07%, and Nginx 197.8 MiB/0.08%. The final exact-permalink pass measured OLS 199.9 MiB/0.08%, Apache 233.1 MiB/0.09%, and Nginx 205.4 MiB/0.05%. Variation between samples is why a single value is not a workload guarantee.

### Packaged mode

A temporary macOS application bundle, locally ad hoc signed, was measured with `app.isPackaged === true`. It contained the production renderer and actual main/preload code, used a temporary profile, and had no Vite/compiler processes. This is not a notarized release installer. It and its profile were removed afterward.

Final visible idle sample: four Electron processes; main 155.3 MiB, renderer 99.6 MiB, sum of process RSS 363.6 MiB. Reported main CPU 0.0050%, renderer CPU 0%. After a separate settled hidden interval: main 156.6 MiB, renderer 102.4 MiB; main CPU 0.0195%, renderer CPU 0.0022%. An earlier post-change packaged pass measured main 164.4 MiB and renderer 115.2 MiB visible, demonstrating sample variation. The preceding hidden sample included the hide transition; settled values exclude that transition.

No pre-audit packaged baseline was recorded, so no packaged improvement is claimed. Release-signing/notarization and Windows/Linux native measurements remain platform acceptance work.

## Idle work and lifecycle

| Work | Trigger and lifetime | Overlap / hidden behavior |
| --- | --- | --- |
| Runtime status | Launch, explicit actions, reveal/focus, tray interaction | Refresh promises coalesce; no repeating idle poll. Focus refresh is limited to once per five seconds and skips active operations. |
| Tray state | State/operation transitions and explicit actions | No per-output-chunk rebuild; refreshes coalesce. Actual Supervisor state is queried on interaction. |
| Progress notifications | Actual operation output | At most one pending 50 ms notification; 300 lines of at most 2,000 characters; timer and buffers cleared on completion/disposal. Hidden windows receive no progress IPC; reveal publishes the latest snapshot. |
| Renderer | State subscription, user interactions, OS theme events | No progress/log/service/hosts polling intervals; terminal mounts only during an operation. Electron background throttling remains enabled. |
| `.htaccess` | Non-recursive event watcher per rewrite-enabled OLS root | Necessary for native rewrite reloads even while hidden; 600 ms debounce; waits for active operations, discards superseded callbacks; closes when stopped, switched, root changes, migrated or disposed. |
| Health / provisioning | Start, replacement and explicit service operations | Bounded retries (typically one-second delays); no idle health loop. Docker commands have termination timeouts; build/package operations allow fifteen minutes. |
| Port probes | Explicit availability checks and startup | Socket timeouts; no idle port loop. |
| Dev startup readiness | Startup only | 200 ms checks, thirty-second deadline, cancellation; Vite and compiler watchers are scoped to relevant sources. |
| Debug resource sample | Explicit development debug flag only | Thirty seconds, sequential; no production timer. |

Logs remain explicit bounded reads (newest 64 KiB; at most 100 listed files), not streaming/polling. Database import/export streams use pipeline backpressure and bounded error tails, rather than retaining dump contents in Electron memory.

## Runtime architecture and defaults

One managed runtime container remains the architecture. Exactly the selected web server handles HTTP and native HTTPS; there is no separate TLS gateway. OLS uses the selected LSPHP binary through LSAPI, one web worker, four maximum PHP children and one retained idle PHP child with a thirty-second idle setting. The unused upstream Docker demonstration listeners/vhost are removed; Vhostra's protected localhost vhost remains.

Apache and Nginx use the selected normal PHP-FPM package over a container-loopback FastCGI listener. The matching FPM package and extension packages are installed alongside the selected LSPHP package so that a server switch retains the requested PHP version. Apache uses `proxy_fcgi`; Nginx uses `fastcgi_pass`. Apache retains native `.htaccess` rules; Nginx retains the managed WordPress front controller. The FPM pool starts workers on demand and has a small child limit. The CLI development server is no longer used for HTTP requests. This adds package storage and a FPM master process when Apache or Nginx is selected; measured costs are recorded below.

Only selected PHP workers execute. Other installed versions in inherited image layers are inactive. OLS process controls follow [LiteSpeed's LSAPI options](https://docs.litespeedtech.com/lsws/extapp/php/configuration/options/). OPcache remains configurable, with a 64 MiB local cache; the PHP policy is applied idempotently on container start.

MariaDB uses a 64 MiB buffer pool, 50 connections, four cached threads, 400 open tables, 16 MiB temporary/heap table limits and a 64 MiB packet limit. Performance schema was already OFF in the baseline and remains OFF. These are conservative local defaults, not restrictive Docker memory limits; imports may use additional memory. Website/database content and automatic phpMyAdmin authentication remain intact.

Disabled Redis/Memcached are Supervisor STOPPED entries with no daemon or placeholder. Enabled Redis is a loopback-only ephemeral cache with a 64 MiB LRU budget; Memcached is loopback-only with 32 MiB, 128 connections and one thread. phpMyAdmin remains ordinary PHP files served by the selected frontend/backend, with existing secure automatic database authentication.

## Images, storage and cleanup ownership

Runtime build tags derive from template contents, selected PHP version, installed extension union and cwebp selection. Frontend choice, ports, optional-daemon enablement, extension enable/disable state and OPcache preferences do not invalidate identical package sets. Candidate and primary runtimes share the compatible image. Ordinary Start checks ownership labels and uses `--no-build --pull never`; missing compatible images build once. Templates resolve from the application location or packaged resources, not an arbitrary working directory.

New images have `com.vhostra.managed=true` and `com.vhostra.purpose=runtime-image`. Cache maintenance retains six recent images and additionally protects images referenced by **any** container, recovery leases, the current image, and images with unknown/foreign tags. It never forces removal. Old scope-specific images without these labels are deliberately left alone; names alone cannot establish ownership. Shared Docker/BuildKit caches are not globally pruned.

| Artifact | Location and retention |
| --- | --- |
| Runtime images | Docker image store; shared compatible tags, bounded owned build cache above. |
| MariaDB data | Active Vhostra `data/mariadb` bind mount; preserved by ordinary lifecycle/cleanup; deleted only by explicit DB deletion or twice-confirmed app reset. |
| Sites | Vhostra-owned localhost files plus explicitly selected external document roots; never deleted by resource cleanup. |
| Generated configuration | Active Vhostra `runtime` and `configuration/generated`; rewritten in place. |
| Logs | Active Vhostra `logs`; Supervisor 5 MiB rotation with three backups per stream; native OLS logs rotate with seven-day retention/compression; Docker JSON logs 5 MiB × three. Native Apache/Nginx output goes into rotated Supervisor logs. |
| User exports/backups | Active Vhostra `exports` / `backups` or explicit export destination; preserved. |
| Automatic import snapshots | Ten newest **completed**, metadata-marked automatic snapshots; active/failed/legacy/unrecognized snapshots preserved. These snapshots exclude website/database contents and secrets. |
| Runtime recovery | Persistent Vhostra `backups/runtime-recovery-*` with recovery metadata and an image lease; removed only after verified promotion/recovery and candidate removal. Unresolved recovery data is preserved for manual recovery, without age-based deletion. |
| Candidate data | Inside the active recovery transaction; one isolated database copy, not two. Candidate container/network removed before transaction data cleanup. |
| Migration failures | Source remains authoritative; failed destination copy is retained when needed for recovery. No automatic deletion of ambiguous or active recovery copies. |
| Dev/native test fixtures | Explicit temporary directories and profiles; cleaned by their harnesses. |

Final Docker inventory contained no audit test containers, the original Vhostra and SpeedClarity containers remained stopped, and the labeled runtime image cache had six tags. No global Docker prune, unrelated container/network/image removal, or persistent volume deletion is used. Successful tests compare unrelated container inventory before/after. Resource cleanup cannot convert a successful promotion into a failed configuration operation.

The final unit suite passes 39 tests. Live acceptance passed all three frontends, selected PHP versions, extension changes, cache process controls, native HTTPS, database import/export/repair/delete, phpMyAdmin automatic authentication, configuration migration, injected promotion failure and verified rollback. Dev lifecycle, terminal, bridge, tray and packaged lifecycle checks passed with isolated profiles.

## Validation and reproduction

```sh
npm test
node test/dev-lifecycle.mjs                 # macOS native process-tree validation
node scripts/measure-packaged.mjs          # temporary macOS packaged measurement
# Run heavy suites sequentially, never concurrently:
node test/performance-runtime.mjs
node test/servers-runtime.mjs
node test/extensions-runtime.mjs
node test/migration-runtime.mjs
```

The native terminal harness verifies active-only Expand/terminal removal, redaction, scroll-back/follow, minimum-window bounds, and bundled-font light/dark rendering. The packaged harness verifies hidden-progress suppression, reveal synchronization, zero retained completed progress and cleared progress timers.

The actual session harness preserves one window and one tray, and restores hidden/minimized visibility. Its `isFocused()` assertion fails in this automated macOS session, including against a temporary checkout of the **original committed implementation**. This is a pre-existing native activation acceptance gap, not a new duplicate-instance finding; manual foreground-focus validation is still required.

## New phase resource budgets (2026-09-28)

First-run preferences are a small local record; the wizard unmounts after successful setup and valid upgrades bypass it. Imports are bounded/on-demand (1 MiB file, 64 directives-bearing site definitions, or 64 LiteSpeed .conf files / 2 MiB selected tree; 4 MiB duplicated original-source budget per import); referenced external paths/symlinks are not followed. Host-generated config synchronization is action-driven. Ten completed automatic import snapshots remain the limit; unresolved recovery is retained.

Resources mounts only on its navigation tab. A single eight-second completion-based timer stops on unmount/visibility changes; visibility generations prevent duplicate timer chains, and renderer/main request guards prevent overlap. Local storage and Docker image inventories are cached five minutes; Refresh storage explicitly remeasures local files. Directory walks cap entries, ignore symlinks, and exclude external site roots. Working-set sums and shared image layers have explicit caveats. There is no new permanent watcher, background monitor, Hosts poll, daemon, or global Docker cleanup.

This phase preserves the one compiler watcher, one OLS worker, optional cache process policy, bounded progress/logging and scoped recovery/image cleanup. New resource measurements and live acceptance results are recorded in the functional audit after validation.

The renewed Hosts audit found accumulating native backup siblings. Writes now preserve a private pre-mutation snapshot under Vhostra's backups, retain ten completed snapshots, and verify bytes within the single elevated operation before removing that operation's exact transient native backup. Failed/active/unknown recovery records stay intact. There is no second administrator prompt and no scan/deletion of arbitrary native backup files.


### Renewed measurements and acceptance

The 2026-09-28 image measured 1,388,363,922 bytes against 1,388,362,776 bytes before this phase: +1,146 bytes from the runtime scripts. No new server/PHP/cache daemon or permanent monitoring process was added. The selected-server/image-reuse/scoped-inventory suite passed.

Initial fifteen-second idle samples were OLS 318.2 MiB/0.07%, Apache 229.8 MiB/0.07%, Nginx 204.0 MiB/0.09%. The higher OLS sample was investigated in a separate isolated run: after thirty seconds it measured 207.7 MiB/0.11%, one retained PHP child, and no System V shared-memory segments. cgroup anon was about 165 MiB and file cache about 100 MiB. A supplementary syntax probe attempted while that listener was already running returned nonzero; it was not counted as an acceptance pass, and its diagnostics were preserved before exact-scope cleanup. The actual pre-start native syntax gates passed throughout the runtime suites. Timing, PHP idle expiry, cache and database warmup affect the samples; no exact RAM improvement is claimed.

Fresh ad hoc packaged visible-idle: four processes, main 168.3 MiB/0.0030%, renderer 107.5 MiB/0%, summed working sets 391.0 MiB. Hidden-settled: main 169.3 MiB/0.0050%, renderer 106.6 MiB/0.0014%, sum 390.9 MiB. These are logical working-set sums, potentially counting shared pages more than once. They are somewhat above the earlier 363.6 MiB single sample and near the earlier 164.4/115.2 MiB main/renderer sample; no app-memory reduction or zero-cost UI feature claim is made. Hidden IPC suppression, reveal synchronization and zero completed progress/timers passed.

The native development lifecycle check confirmed one tsc watcher and no orphan children after startup cancellation, Electron exit or Ctrl+C. Identification now uses the watcher's command, since measured compiler RAM ranged below the old test's 250,000 KiB identification threshold. The actual two-launch native session check now passed foreground focus as well as hidden/minimized restore, superseding the earlier automated focus gap above on this Mac.

The final suite passes 53 automated tests. Sequential live/native acceptance and remaining OS/release boundaries are recorded in VHOSTRA_FUNCTIONAL_AUDIT.md. Six positively labeled build tags remain; two protected recovery lease tags and failure diagnostics are deliberately retained. No temporary test container/network remains, and unrelated project inventory stayed unchanged.

## Host-storage completion measurements — 2026-09-28

These renew the historical samples above for host logs and consolidated UI. Tests used isolated high-port profiles/scopes. The original `vhostra-runtime-1` was running during this phase and remained untouched. All heavy Docker tests ran sequentially. Samples are idle observations after health checks, not peak-load guarantees.

| Runtime · PHP 8.5/APCu/native TLS | Previous final sample | Host-storage sample |
| --- | --- | --- |
| OpenLiteSpeed RAM / CPU | 199.9 MiB / 0.08% | 202.1 MiB / 0.15% |
| Apache RAM / CPU | 233.1 MiB / 0.09% | 230.9 MiB / 0.04% |
| Nginx RAM / CPU | 205.4 MiB / 0.05% | 205.0 MiB / 0.10% |
| Compatible image bytes | 1,388,362,776 | 1,388,516,952 |

Image increase:154,176 bytes (about0.147 MiB) for logrotate support. All three selected frontends reused the same owned image, with build counter0 during settled acceptance. Changes are within the earlier sampling variation; no RAM/CPU improvement or workload guarantee is claimed. Exactly the selected frontend runs. Apache/Nginx have one conservative log-maintenance shell/sleeper (five-minute check of generated known paths), OLS uses native rolling; disabled Redis/Memcached have no daemon/sleeper. Real enabled/disabled cache-process checks passed. No extra Electron timer or hidden Resources sampler was added.

The latest temporary ad hoc signed packaged app had four Electron processes. Visible-idle summed RSS387,728 KiB (378.6 MiB), main166,448 KiB (final exact sample in `/tmp/vhostra-packaged-final.log`); main CPU0.0852%, renderer0.0024%. Settled hidden sample: main160,400 KiB, renderer97,840 KiB, summed366,464 KiB (357.9 MiB), mainCPU0.0022%, renderer0.0018%. Shared pages can be counted repeatedly. Prior packaged visible sum363.6 MiB is a separate historical sample, not an exact matched-load baseline. Hidden progress IPC/timers/buffers were verified dormant. This is an ad hoc measurement bundle, not signed/notarized release acceptance.

Site/access/error logs are stable host files. Apache/Nginx use size-threshold5 MiB copytruncate and three retained copies, checked every five minutes; this is a threshold/sampling policy, not a hard instantaneous size ceiling. Focused real-runtime writes exercised four rotations and verified active host-file truncation and exactly three copies. A first synthetic test alternated host appends and runtime truncation and encountered Docker Desktop shared-filesystem visibility; corrected acceptance writes in the runtime as actual frontend processes do. OLS rolls natively at5 MiB with seven-day compressed retention. Application logs rotate at1 MiB plus three; Supervisor/Docker streams retain5 MiB plus three. Explicit Logs reads remain64 KiB and100 files, with direct scoped Site/runtime filters.

Configuration changes/restart now recreate the disposable container even when Compose inputs match, while reusing the compatible image and host DB/root/log data. This fixes stale OLS working copies and costs transient restart work, not idle background work. Ordinary already-running Start still reuses the container/image. No external Site tree copying occurs. Rewrite off/on was verified over HTTP on each selected frontend with localhost unaffected.

Source audit found and removed obsolete TLS-gateway generation. cwebp installation now clears apt caches/indexes; the renewed server/CLI suite verifies actual disable/enable, persisted selection and cleanup. Updated reproduction: `node test/performance-runtime.mjs` (all frontends), `--nginx-only` (targeted continuation), `node test/log-rotation-runtime.mjs`, `node scripts/measure-packaged.mjs`. Failed fixture profiles are retained only for local diagnostics, successful fixtures are removed; no global prune.

## 2026-09-29 database/error/selection phase

- Database and filtered account inventory remains event-driven: screen entry, relevant mutation, or explicit Refresh. Account inventory performs four fixed metadata queries for identities, direct schema privileges, existing globals and role names. It never reads authentication hashes for UI; row assembly uses linear maps instead of repeated grant scanning. No database polling or idle grant enumeration was added.
- Setup/access changes and explicit Check Database Access run one bounded stdin-only PHP probe with mysqli/PDO against localhost socket and 127.0.0.1 TCP, checking the selected exact account and session-only temporary-table writes. There are no background credential probes. Existing runtime refresh coalescing/service sampling remains. A stopped web runtime prevents a false-success setup claim; MariaDB lifecycle stays independent.
- Error parsing operates on at most 12 KiB of already available sanitized output; private PHP probe stdout is capped at 16 KiB and a 30-second deadline. Known mount mapping uses existing in-memory state on failures, with a generic fallback. No error-time configuration scan or large diagnostic suite runs. Disclosure/selection uses native details/CSS, with no selection listeners.
- No dependency or production network endpoint was added. New application passwords are cleared after operations, transmitted to SQL/PHP only through stdin and not retained in the long-lived secret registry. Persistent backup auth stays private under the existing backup mechanism.
- Production build `/private/tmp/vhostra-db-build.log`; 99/99 regressions `/private/tmp/vhostra-database-unit.log`; real local SQL/PHP/WordPress and Electron evidence in `/private/tmp/vhostra-database-access-live.log` and `/private/tmp/vhostra-database-access-ui.log`. No new idle-RSS or CPU reduction is claimed. The previous budgets and native environment boundaries still apply.

Prior actual server/PHP/cache/database/CLI/reset and full-backup reconciliation regressions also passed in sequential isolated scopes (`/private/tmp/vhostra-database-persistence-regression.log`, `/private/tmp/vhostra-database-backup-regression.log`); previous desktop regression passed (`/private/tmp/vhostra-database-desktop-regression.log`). Exact inventory/fixture cleanup passed. These are functional/performance-preservation checks, not new benchmark claims.

# Named Site preview validation (2026-09-29)

Preview infrastructure has no idle polling/timer, permanent capture window or retained screenshot renderer. A cleared memory-only session is reused; permission/download/request/TLS callbacks are removed after each capture. At most six requests are admitted, deduplicated by Site, and captures run sequentially. Dashboard exit and native hide/minimize cancel active capture; queued jobs recheck visibility before work. One bounded Hosts metadata read and named loopback response-header probes replace generic loopback navigation. Resolver deadline is 6s, connection timeout 1.5s, redirect cap four, admitted candidate cap sixteen and total capture deadline 15s. DOM readiness plus 500ms rendering avoids network-idle waits. Failed automatic attempts are bounded to 500 entries with a ten-minute retry guard; successful cache entries do not block regeneration of missing files. There is no timer to retry them. A transition to a healthy runtime clears the failure guard so Dashboard can retry immediately after service recovery.

Cached identity checks avoid regeneration on normal React renders, PHP/server switches and unused-alias additions. Actual hostname/root/protocol/port changes or removal of the used alias invalidate owned cache files. Cache remains one ≤1MiB 960×540 quality75 JPEG per Site, stored on the host; images are never copied into application state. A three-Site concurrent request fixture observed **maximum one capture window**; after repeated refresh, cancellation and actual page-load timeout, **zero capture windows and zero Tab renderer processes** remained. Idle Node resource inventory contained only two test HTTP/TLS servers and the test deadline timer, with no preview connection/timer. No network requests occurred during the five-second quiet interval.

Local Electron sample (`/private/tmp/vhostra-preview-resource-proof.json`): a long/wide identifiable page compressed to **7,268 bytes** with neither deliberately colored scrollbar present. Six refresh samples showed main-process working set rising and then falling with collection (roughly 165–202MiB in that run); final main working set was about 148MiB, with GPU/utility processes and no preview renderer. Main CPU over the separately measured five-second quiet interval was **1.55%**; GPU and utility metric samples were 0%. This is a small local whole-test-app sample including browser/GC overhead, not an idle-product CPU guarantee or a promise that all memory returns immediately to its pre-capture baseline. The absence of screenshot polling/retained renderers is independently verified by source and resource inventory.

Actual Nginx/Apache/OpenLiteSpeed captures, configured HTTP/HTTPS/custom ports, named alias/default separation, unchanged external files and exact Docker inventory cleanup passed in `/private/tmp/vhostra-preview-live.log`. Native Dashboard/IPC fallback/cache/URL-selection/tray/reset acceptance passed in `/private/tmp/vhostra-preview-ui.log`. Full build/contracts and architecture notes are in `docs/site-previews.md`. No package/dependency, remote screenshot API, upload, telemetry or background scan was added. Existing database/cache/log/Resources/Hosts budgets remain in force.

## Additive active-regression phase (2026-09-29)

The missing-header compatibility proof is on demand and scoped to the owned runtime: bounded active OLS main config (1 MiB) and one vhost config (64 KiB), plus owned published-port metadata. It does not read Site contents, regenerate configs, restart services, monitor Hosts or create a daemon. Resolver-local origin proofs expire with the request. Normal header-bearing runtimes skip the native proof. Electron's private resolver is checked only on capture. Existing six-request sequential queue, 15s capture deadline, cache budgets, hidden/unmount cancellation and BrowserWindow/session cleanup remain intact. Explicit Refresh Preview adds one six-second success-expiry timer in its mounted card, cleared on unmount; no screenshot/database/routing polling or idle renderer was added.

Selection remains CSS-only with individual semantic classes and explicit terminal output lines; no selection listener, observer or scan runs. Duplicate recovery uses the existing event-driven SQL inventory refresh. No new npm package or production endpoint was added. Full third-party legal evidence occupies about 10 MiB locally, with the ~20 MiB complete Chromium notice stored losslessly compressed (rather than a second uncompressed copy). The packaging configuration retains these necessary local notices. No new CPU/RAM reduction is claimed; renewed window/renderer teardown and request-quiet acceptance pass in the additive Electron log.
# Visual readiness sample (2026-09-30)

The isolated Electron preview acceptance ran first automatic named and localhost captures, then repeated captures and recurring-request and delayed-asset fixtures. The capture queue reached one active window at most; the post-capture process inventory had no `Tab` renderer. Six post-capture process working-set sums were 320–350 MiB, compared with 234 MiB before capture; final Browser/GPU/Utility working sets were 170/76/48 MiB. The JPEG sample was 7,268 bytes. The five-second idle main-process CPU sample was 0.04% in this run. These are one-machine samples, not a like-for-like before/after proof of a RAM or CPU improvement. The readiness observer and 100 ms sampler exist only inside the temporary capture renderer and end before the screenshot; no idle polling was added. Source: `/private/tmp/vhostra-preview-resource-proof.json`.

## Service/database UX continuation — 2026-09-30

Source inspection: one local React state toggle per visible password field, no visibility listener or backend request; database users refresh on tab entry/relevant mutation; import emits one IPC completion event; pending preview retry is event-driven. The existing transient screenshot renderer, 15-second capture limit, bounded visual readiness, scrollbar suppression and teardown remain. No new dependency, endpoint, background polling or remote screenshot service was added. `npm run build` passed; no new idle CPU/RAM or storage measurement has been taken, so no resource improvement is claimed. Complete measured acceptance remains open in VHOSTRA_EXECUTION_STATE.md.

Explicit database preview gating adds at most one on-demand managed-service snapshot and database list for an associated Site when capture is requested; it does no work while that Site waits for an expected SQL import. The availability check precedes BrowserWindow creation. One IPC completion signal replaces any retry timer. No new idle database query was added.

Isolated service controls acceptance (`/private/tmp/vhostra-service-controls-live.log`) sampled web runtime 69.78 MiB/0.04% CPU and MariaDB 129.2 MiB/0.03% CPU after 15 seconds, with separate containers. Scoped host storage was 220,416,947 logical bytes, including 162,018,931 bytes MariaDB data and 58,368,769 bytes managed Site files; the measurement excludes external Site roots. Docker attributed managed image bytes were 9,338,480,614 across Vhostra profiles and can include shared layers; scoped writable layers were 150,118 bytes. This is an isolated fixture sample and does not prove a before/after reduction. No unrelated Docker inventory changed.

Native preview acceptance retained at most one transient capture window, and had zero BrowserWindows after the pending/import capture and subsequent captures. The pending Site made no HTTP request and created no capture window before readiness. The existing quiet-interval and renderer-teardown assertions passed; sample details are in `/private/tmp/vhostra-preview-resource-proof.json` and `/private/tmp/vhostra-service-preview-live.log`. This demonstrates absence of preview polling/retained renderer in the fixture, not a whole-app CPU reduction.

Final native preview regression after a two-second minimum visual-settle interval passed with one active capture window at most, no retained Tab renderer, and no requests or renderer for the pending database Site. The interval exists only during active capture and remains under the 15-second deadline. The MariaDB failed-start check used a temporary loopback listener and stopped it before exact-scope cleanup. No idle watcher or polling was added. Account password controls are component-local state only. A real PHP/SQL preview acceptance is in progress; no resource improvement claim is made for it yet.

The real PHP/SQL preview acceptance used no capture renderer before the expected import, and the first post-import screenshot was 960×540 with loaded database content. The temporary renderer was destroyed after capture; sequential real-runtime static and database Site checks and exact-scope cleanup passed. The final unit suite was 109/109; the isolated service sample above is the only new idle CPU/RAM measurement, so no broad whole-app reduction is claimed. No new polling, watcher, upload, screenshot service, telemetry or persistent capture process was introduced.

## Required fixes continuation (2026-09-30)

Logs remains on-demand: the renderer retains one selected 64 KiB tail, the existing backend caps a listing at 100 files, and the screen mounts only while active. No log interval, watcher, remote stream or hidden renderer was added. Service transitions use backend lifecycle revisions; the visible Services page coalesces revision/state events with a 100 ms one-shot timeout and performs no hidden polling. Database inventory remains on tab entry, mutation or explicit Refresh. First-run path selection makes one layout read and on-demand migration; there is no path watcher. phpMyAdmin reuses the existing MariaDB container; the test uses isolated temporary Compose scopes and cleans them up exactly. The 64 MiB SQL upload limit replaces the base PHP image's much larger upload setting; a real phpMyAdmin form advertised 67,108,864 bytes and a small SQL upload succeeded.

No comparable new idle CPU/RAM/storage sample was taken after these changes, so no resource improvement or full performance closure is claimed. The prior resource samples above remain historical baselines. A controlled visible/hidden idle comparison and retained fixture storage audit remain the next measurement gate.

### Isolated follow-up samples

`node test/performance-runtime.mjs --nginx-only` passed its selected-process, PHP/APCu/HTTPS, rewrite, database, optional-cache and four actual log-rotation checks with exact Docker inventory cleanup. After 15 seconds, Docker reported Nginx runtime **54.46 MiB / 0.05% CPU / 10 PIDs** and MariaDB **130.9 MiB / 0.03% CPU / 16 PIDs**. The compatible runtime image was **1,145,382,538 bytes**. This fixture used PHP 8.5 and preceded the later required PHP cURL package addition, so its image size and memory are not a final after-change measurement and are not directly matched to the earlier PHP/APCu profiles.

The matched post-cURL fixture used the same PHP 8.5/APCu Nginx test and passed the same checks with exact scope cleanup. Its 15-second sample was web runtime **58.89 MiB / 0.04% CPU / 10 PIDs** and MariaDB **126.3 MiB / 0.02% CPU / 16 PIDs**. The image was **1,154,859,945 bytes**, an increase of **9,477,407 bytes (about 9.0 MiB)** against the immediate pre-cURL fixture. The web RAM difference was +4.43 MiB and MariaDB -4.6 MiB in these two samples; neither establishes a sustained memory trend. No optional cache daemon was present when disabled, and no new always-running process was added.

The final ad hoc packaged Electron run exited 0 and removed its temporary bundle/profile. Visible-idle main was **163,232 KiB / 0.0048% CPU**, renderer **96,096 KiB / 0% CPU**, and the four-process RSS sum **367,360 KiB**. Hidden-settled main was **154,032 KiB / 0.0012% CPU**, renderer **96,272 KiB / 0.0002% CPU**, and the sum **350,512 KiB**. Hidden progress suppression, reveal synchronization and buffer/timer dormancy passed. An earlier sample had visible/hidden sums 375,152/376,480 KiB but its temporary-profile removal raced Chromium. The fixture now makes the parent remove the profile after test-app exit and bypasses the product's interactive quit confirmation only within the measurement process. These process RSS sums can count shared pages repeatedly and are samples, not a matched baseline or proof of no regression. No new production polling, background process or remote endpoint was introduced by this continuation.

## Lifecycle and local export continuation — 2026-10-01

The isolated Nginx/MariaDB fixture (`/private/tmp/vhostra-required-lifecycle.log`) ran sequentially with an exact Docker scope and restored the original container inventory. Warm-image Start Services took 26.09 s: `Starting` was emitted about 1 ms after command acceptance, the MariaDB container began at 3.84 s, and MariaDB `Running` was emitted at 14.40 s after Docker health was confirmed. The gap between container start and confirmed health was about 10.56 s. Vhostra's MariaDB healthcheck interval is 10 s and the active readiness loop checks Docker state once a second; this interval plausibly accounts for much of the observed readiness gap, but the fixture does not prove the database process's exact SQL-ready instant. MariaDB started and became ready before the web runtime in this sample. The earlier cold-image fixture took 99.61 s overall, dominated by web image preparation; it is not a matched MariaDB timing comparison.

Stop Services took 4.54 s: `Stopping` was emitted immediately; Docker recorded MariaDB termination at 4.23 s and the final `Stopped` event at 4.35 s. Start followed by Restart Services took 52.81 s in the warm fixture, including the required restart transaction; MariaDB and web published transitional states. A transient web `Stopped` event during startup was found in the first run and fixed. A later stricter restart check caught disabled caches briefly marked Restarting; the final isolated run passed with disabled caches remaining Disabled and no overall Running snapshot carrying a transitional service. The independent MariaDB test also passed real Starting, Stopping, Stopped and failed-start checks. No artificial UI delay was added.

Transitional service states now ride the existing backend event stream directly to the visible Services page. Final-state refresh remains coalesced; no new idle Docker polling, renderer timer, service process or dependency was added. Config export uses an on-demand native generator and a small local file. Database export uses the existing streamed `mariadb-dump` path and an atomic destination rename; SQL is not loaded into React or rewritten. The independent MariaDB fixture exported over 1 MiB and rejected an invalid destination; the native UI fixture (`/private/tmp/vhostra-required-export-ui.log`) passed cancellation/error paths and cleaned its profile. These checks establish bounded export architecture and correct scoped cleanup; they do not measure peak dump memory or all server/cache combinations.

Post-change packaged Electron sample (`/private/tmp/vhostra-required-packaged-performance.log`): four-process RSS sum was **420,672 KiB visible-idle** and **422,384 KiB hidden-settled**; Browser CPU was **0.0023%** and **0.0038%** at those points. The short hidden transition sample reached 0.0872% Browser CPU. Hidden progress IPC suppression and buffer/timer dormancy passed; the temporary bundle/profile were removed. This is one isolated profile and a different run from the earlier 367,360/350,512 KiB sample. The higher RSS sums cannot establish a sustained regression or a memory improvement without matched repeated trials; Electron process sums can count shared pages more than once. No new production idle poll, renderer or daemon was introduced. Peak SQL dump memory remains unmeasured.

The final bounded MariaDB readiness change keeps Docker's 10-second idle health interval but probes the same local SQL socket and gateway once a second only while a Start operation waits for readiness. A verified container ID is reused and each probe has a five-second cap; no probe persists after startup. Final isolated warm-image run (`/private/tmp/vhostra-required-lifecycle.log`): command-to-MariaDB-container start **4.02 s**, container-start-to-confirmed-Running **4.89 s**, full Start Services **20.64 s**, Stop Services **5.57 s**, and the Restart Services transaction **21.39 s**. That run also included individual web Stop/Start and PHP stopped-state acceptance between full Start and Stop. The earlier comparable fixture measured 10.56 s from MariaDB container start to Docker-health-based Running. These are separate runs with normal machine/load variation, so the difference is evidence that the health interval no longer gates visible readiness, not a controlled benchmark of database engine speed. Running still requires a successful real SQL query and gateway process check, while Docker unhealthy/crash state takes precedence. No extra idle CPU work was added.

## Vhost identity conversion sample — 2026-10-01 (historical, before Site unification)

The former OpenLiteSpeed folder export was generated only when selected by the user. It writes one small server config and one vhconf under an explicitly chosen local destination, with no retained export cache, runtime build, browser renderer or network request. Directory import now opens only the selected `httpd_config.conf` and referenced regular vhconf files; it does not enumerate an entire server tree. The existing canonical record remains the only persisted hostname source, and there is no hostname polling or background conversion.

In a single local Node process, 1,000 iterations of Apache, Nginx and OpenLiteSpeed string export plus one Nginx import each (4,000 operations) took **22 ms wall time**, **31 ms process CPU**, and increased RSS by **7.45 MiB** during warmup/allocation. The generated strings totalled **3.67 MiB** but were not retained; persistent export files created: **0**. This is an in-process micro-sample of small configs, not a peak-memory guarantee or an Electron idle measurement. Focused Add/Edit/conversion tests passed in 53 ms and the OpenLiteSpeed map-merge test in 6 ms in a separate run. The isolated live routing check passed all three servers and both aliases but did not collect comparable runtime RAM samples. Existing packaged Electron idle and runtime memory samples above remain the available idle evidence; no new long-lived work was introduced.

## Unified Site and dialog preference — 2026-10-01

The Site/virtual-host pair is now persisted as one JSON record per Site; the AppState virtualHosts value is derived on demand from those records. Migration checks the legacy directory during initial store setup and does no polling afterward. The one-time recovery copy is bounded to two retained owned snapshots. OpenLiteSpeed export writes one small file on user request instead of a folder with two files. The dialog preference writes one directory string after successful selection and checks it only on dialog opening; no watcher, timer, history or network request was added. Focused tests passed, but no matched idle Electron CPU/RAM or storage before/after sample was collected for this change, so no measured reduction is claimed. An isolated migrated-Site Docker fixture passed OpenLiteSpeed/Apache/Nginx routing with exact scope cleanup, and the two-process native dialog fixture passed. Neither fixture collected matched idle CPU/RAM or storage samples; those measurements remain open.

Post-change isolated production-bundle Electron sample (`/private/tmp/vhostra-unified-performance.log`): visible-idle Browser CPU **0.0071%**, four-process RSS sum **424,944 KiB**; hidden-settled Browser CPU **0.0030%**, four-process RSS sum **424,528 KiB**. Hidden progress suppression and buffer/timer dormancy passed. The temporary profile occupied **10,180 KiB** before exact-scope removal. This is an unpackaged single-run sample with a different profile and environment from the historical packaged sample; it does not establish a matched RAM or CPU trend. The sample confirms that the new dialog preference and Site projection introduced no observed busy idle loop in this fixture.

## Help content/search — 2026-10-01

Help uses one static topic array and one lowercase searchable representation built at module evaluation; filtering occurs only on Help input/render while the page is mounted. No dependency, request, search worker, index cache, polling or new idle process was added. The production build completed with a 299.12 kB JavaScript asset (85.43 kB gzip) and 25.09 kB CSS asset (5.94 kB gzip), including the entire app; this is a post-change size, not a matched baseline. Copy feedback creates a single 1.8-second timeout only after clicking Copy. No controlled pre/post Electron CPU, RAM or packaged-size measurement was taken, so no measured improvement or absence of regression is claimed.

An isolated Electron Help fixture sampled the visible page four seconds after search/copy and narrow-window capture. `app.getAppMetrics()` reported Browser **0.019% CPU / 231,056 KiB RSS**, GPU **0.091% / 94,336 KiB**, Utility **0.0006% / 47,744 KiB**, and Tab **0.033% / 135,392 KiB** (508,528 KiB summed RSS). The profile was temporary and did not start Docker services. This single post-change sample includes Electron, the app and test instrumentation, and is not a matched regression comparison or a steady-state guarantee; process RSS sums can count shared pages more than once.

## Help tabs and CLI sample — 2026-10-01

Help mounts one category panel and scans a static in-memory text array only while visible. Search adds no network request, worker, polling timer, history or disk index. The fixed window computes display work area once when created, without display polling. CLI help exits before loading the runtime backend. On this Mac, three sequential source CLI subprocess samples using one temporary isolated profile took 0.151 s for `help` (exit 0), 0.488 s for `runtime status` (exit 2 because Docker was unavailable in the sandbox), and 0.189 s for `database list` (exit 1, MariaDB Not Created). Each subprocess returned within its timeout. These are startup/exit samples, not CPU or RSS measurements. The sandboxed Electron invocation aborted in macOS LaunchServices; an isolated unsandboxed fixture then passed. Its four-second visible Help sample reported Browser 201,776 KiB/0.0148% CPU, GPU 93,808 KiB/0.0494%, Utility 47,776 KiB/0.0006%, and Tab 132,832 KiB/0.0197%. These are one-process-type samples, not a matched before/after improvement or whole-system idle claim. No live-runtime/RAM or storage-growth comparison is claimed. Earlier measurements in this file remain historical.

## Runtime/settings/service/CLI/startup follow-up — 2026-10-01

The wrapped Help fixture sampled one visible process set after search/copy: Browser 192,544 KiB RSS / 0.0245% CPU, GPU 88,464 KiB / 0.1190%, Utility 42,400 KiB / 0.00029%, Tab 130,320 KiB / 0.0446% (single sample; not a matched idle regression measurement). The Settings pending state and startup preferences add no polling loop; startup uses one native login launch argument and one conditional service-start call. The packaged macOS app archive shrank from 310 MB to 3.8 MB after excluding build-time dependencies and moving package output outside `dist`; the unsigned app bundle is about 305 MB, dominated by Electron. These are local artifact sizes, not installed disk-usage measurements. The isolated CLI processes exited within their 20-second fixture deadlines. Docker builds ran sequentially and removed exact fixture scopes; no global prune was used. Matched desktop/runtime idle CPU, RAM, and Docker storage before/after samples remain open.

## Docker discovery and PHP-FPM continuation — 2026-10-02

Docker discovery checks only PATH and bounded platform locations, then runs bounded version/daemon probes when requested. It adds no background polling. The selected executable path, if any, stays in the local profile. A packaged macOS GUI with `PATH=/usr/bin:/bin` found the running Docker installation and opened Welcome without a setup prompt. Three sequential real daemon checks with the same minimal PATH returned Ready in **140.0, 152.8 and 139.2 ms**. These are one-machine wall-clock samples, not a startup budget or cross-platform guarantee.

The sequential PHP 8.5/APCu fixture measured each selected server 15 seconds after start, using the same image (`1,360,309,867` bytes) and separate web containers against one independent MariaDB container:

| Server | Web container RAM | Web CPU sample | MariaDB RAM | MariaDB CPU sample | Web PIDs |
| --- | ---: | ---: | ---: | ---: | ---: |
| OpenLiteSpeed / LSAPI | 49.63 MiB | 0.25% | 129.1 MiB | 0.03% | 8 |
| Apache / PHP-FPM | 52.03 MiB | 0.04% | 130.7 MiB | 0.06% | 21 |
| Nginx / PHP-FPM | 47.78 MiB | 0.04% | 129.8 MiB | 0.01% | 9 |

The active Apache/Nginx process list included `php-fpm8.5` and no `lsphp`; OpenLiteSpeed included `lsphp` and no FPM. The fixture verified APCu through actual HTTP, native HTTPS, rewrite, SQL and log rotation, then removed its exact scope. Container RAM/CPU are one Docker sample after activity, not a steady-state guarantee. The image is about 205 MB larger than the earlier post-cURL Nginx image, but those samples are separated by other image/base changes and are not a controlled storage attribution to PHP-FPM alone.

A separate four-state cache fixture sampled the web container 10 seconds after each start, with the same image and PHP 8.5/APCu configuration: both disabled **64.50 MiB / 0.24% CPU**, Redis only **60.93 MiB / 0.49%**, Memcached only **55.02 MiB / 0.29%**, and both enabled **64.05 MiB / 0.51%**. Each state used a new container; the service process assertions passed. The differences include container startup/cache variation, so these snapshots do not yield a reliable per-daemon incremental RAM estimate. Disabled services had no daemon process. The fixture removed its exact scope.

A more comparable follow-up toggled Supervisor programs within **one** isolated OpenLiteSpeed container, taking Docker stats ten seconds after each state: caches off **65.96 MiB**, Redis only **67.61 MiB**, Memcached only **63.55 MiB**, both **72.20 MiB**. The `redis-server` process showed **16,856 KiB RSS** when running; `memcached` showed **6,012 KiB RSS**. The Redis-only container reading was +1.65 MiB over its baseline and both-on was +6.24 MiB. The Memcached-only reading was lower than baseline because an idle LSPHP child exited between samples; these Docker container readings include process churn, shared pages and reclamation, and should not be interpreted as exact additive daemon costs. The isolated scope was removed.

An ad hoc signed, isolated `app.isPackaged` macOS bundle sampled four Electron process types after ten seconds visible idle: Browser **184,096 KiB / 0.0030% CPU**, GPU **79,888 KiB / 0.00025%**, Utility **48,128 KiB / 0%**, Tab **112,032 KiB / 0%**. Their summed working sets were **424,144 KiB**; shared pages can be counted more than once. After another ten seconds hidden and settled, the four-process sum was **424,624 KiB** with about **0.0053%** summed sampled CPU. The hidden-progress fixture also verified no progress IPC or retained timer/buffer while hidden. This is one post-change packaged sample, not a controlled before/after comparison. The final unsigned `Vhostra.app` occupied about **334 MB** on this Mac; its `app.asar` was **4,004,681 bytes**. The app bundle includes Electron, so archive size is not the runtime image size or installed host storage total.

Three isolated bundled CLI invocations from outside the checkout, with `PATH=/usr/bin:/bin`, exited 0: `help` **309.1 ms**, `status` **2,194.7 ms**, and `php status` **1,921.3 ms**. The status commands include local profile initialization and Docker/runtime state checks; these are wall-clock samples on this Mac, not a cross-platform startup guarantee.

## 2026-10-02 UI/CLI phase measurements

The isolated Help Electron fixture sampled four app processes after its search/copy interactions: Browser 183,280 KiB / 0.0235% CPU, GPU 84,320 KiB / 0.1201%, Utility 42,192 KiB / 0.0008%, and Tab 124,656 KiB / 0.0430%. Summed working sets were 434,448 KiB; shared pages may be counted more than once. This was a post-interaction sample, not a steady packaged idle measurement. The fixture recorded zero Help `fetch` calls, and search has no background index, worker or persistence.

The rebuilt unsigned macOS app measured 334 MB by `du -sh`; its `app.asar` was 4,008,007 bytes. From `/private/tmp` in a fresh temporary profile, the packaged launcher completed read-only `help` in 228.8 ms (exit 0) and `status` in 2,178.5 ms (exit 0). These are single wall-clock samples. The existing same-container Redis/Memcached RAM measurements above remain the available incremental cache evidence; this phase did not repeat that heavy fixture. Live CLI fixtures used one Docker project sequentially and verified exact resource cleanup.

## 2026-10-02 completion UX sample

The completion-scroll hook has no timer, observer, polling loop or persistent history. It runs one layout effect per explicit completed operation and reads one target and pane rectangle. Help search continues to scan the small static local topic array while Help is mounted; the native fixture observed zero Help-triggered `fetch` calls. Its post-interaction process sample was Browser 207,552 KiB / 0.0281% CPU, GPU 78,848 KiB / 0.1160%, Utility 41,840 KiB / 0.00033%, Tab 119,184 KiB / 0.0380%. This is a single post-interaction sample, not a matched idle comparison. New standalone database-user creation runs a single exact preflight and inventory refresh, with no database polling. No new dependency or persistent index was added.

The final packaged resource fixture sampled Browser/GPU/Utility/Tab after visible idle at **163,504 / 66,064 / 41,312 / 100,208 KiB RSS**, totaling **371,088 KiB** with about **0.00536%** summed sampled CPU. Hidden and settled values were **156,432 / 63,984 / 39,680 / 101,872 KiB**, totaling **361,968 KiB** with about **0.00268%** CPU. Shared pages can be counted more than once in these RSS sums, and these are one-machine snapshots after activity, not a matched baseline or guarantee. Hidden progress suppression and buffer/timer dormancy passed. The unsigned app occupied **334 MB** by `du -sh`; the final rebuilt `app.asar` was **4,011,755 bytes**. The normal builder attempted a remote Electron download and could not reach it; rebuilding against the already installed local Electron distribution succeeded. The final sequential CLI matrix and native Database fixture cleaned only their own temporary scopes. No global Docker prune was used. The subsequent preview timeout-stage diagnostic adds no timer, observer or background work beyond the capture's existing 15-second deadline; packaged CPU/RAM was sampled before this small diagnostic-only rebuild and was not remeasured.
Manual update checking is event-driven from About: no startup request, recurring timer, updater worker, or persistent check history. Each click uses a single eight-second bounded GitHub Releases request capped at 64 KiB. Docker prerequisite checks remain bounded local probes after launch or an explicit recheck; the installer handoff starts no background process.

Release CLI integration adds no resident process or timer. Windows modifies only local HKCU PATH during install/uninstall; macOS checks one fixed command link at packaged launch from Applications; DEB/RPM hooks and the explicit AppImage action run only at user/package operations. No PATH value, site information, or CLI history is transmitted. The manual GitHub update request still occurs only after Check for Updates.
