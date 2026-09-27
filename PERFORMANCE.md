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
| MariaDB data | Active Vhostra `data/mariadb` bind mount; never automatically deleted. |
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
