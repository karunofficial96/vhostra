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

Apache and Nginx use the **same selected LiteSpeed package's PHP CLI development server**, bound only to container loopback, with two additional workers. No second OpenLiteSpeed daemon, unrelated PHP version, new extension ABI, or PHP-FPM package is introduced. The router maps only generated host/document-root records, rejects traversal/nonexistent PHP scripts, preserves original request paths and HTTPS/Host information, and never serves PHP source as static content. Apache forwards the original request line (including query strings) across internal rewrites, using [Apache's `THE_REQUEST` expression](https://httpd.apache.org/docs/2.4/expr.html). Apache retains native `.htaccess` rules; Nginx retains the managed WordPress front controller. This is a development SAPI, not a production hosting backend. See the [PHP development-server manual](https://www.php.net/manual/en/features.commandline.webserver.php).

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
