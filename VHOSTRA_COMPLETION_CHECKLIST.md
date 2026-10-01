# Current additive queue — routing / selection / duplicates / notices (2026-09-29)

- [x] Reproduce localhost and named preview failures against the existing runtime; trace config, Hosts, protocol/ports, response and Electron separately.
- [x] Verify server-owned routing without requiring Site content; accept older owned native config safely. Test HTTP/TLS/custom ports, aliases, wrong default, viewport/scrollbars, refresh, cleanup and local-only requests.
- [x] Strict CSS default; explicit selectable status/name/alias/path/message/diagnostic/editable content across all screens. Service names must remain unselectable.
- [x] Exact Custom User@Host preflight before mutations, localhost default, preserved Database Name, existing-account recovery, grants/connectivity/rollback and immediate SQL list refresh.
- [x] Simple primary errors/success and sanitized expandable details.
- [x] Create THIRD_PARTY_NOTICES.md, verified license materials and full dependency/asset/server inventory; record uncertain provenance/terms and distribution actions. No Vhostra LICENSE.
- [x] Renew privacy/performance audit and persistent evidence; preserve external acceptance boundaries and all prior functionality. No commit.

All 56 additive requirements are covered by these grouped acceptance gates and the supplied request preserved in docs/routing-selection-notices-request.md. Historical completion claims below are reopened where contradicted by current runtime/UI evidence.

- [ ] Public distribution verification: original Red Broadcast MIT notice, exact artwork/font/branding rights, frozen image/platform/source/Redis obligations and final package notice inclusion. See THIRD_PARTY_NOTICES.md; verified audit creation does not clear these requirements.
- [x] Supplementary isolated database rollback/WordPress regression passed with exact scope cleanup and unchanged unrelated inventory: /private/tmp/vhostra-additive-db-live.log.

---

# Backup reconciliation / desktop completion — local acceptance complete 2026-09-29

This section supersedes older backup/tray/cache descriptions. Full request is preserved in `docs/backup-reconciliation-request.md`; implementation, test evidence, limitations and the next action are recorded at the top of `VHOSTRA_EXECUTION_STATE.md`. Checkmarks below mean implemented and locally verified; native cross-platform/protected-prompt/release acceptance remains open under R52 and the inherited unchecked items.

- [x] R1: AUDIT FIRST
- [x] R2: REDIS DEFAULT APPLICATION HOST MUST BE LOCALHOST
- [x] R3: MEMCACHED DEFAULT APPLICATION HOST MUST BE LOCALHOST
- [x] R4: LOCALHOST MUST BE REAL, NOT JUST UI TEXT
- [x] R5: PRESERVE CACHE CONFIGURATION
- [x] R6: TRAY ICON DISAPPEARS — BUG
- [x] R7: TRAY LIFECYCLE
- [x] R8: MINIMIZE VS MINIMIZE TO TRAY
- [x] R9: EXPLICIT QUIT
- [x] R10: REMOVE UNNECESSARY ELECTRON MENUS
- [x] R11: macOS MENU CARE
- [x] R12: TEXT SELECTION POLICY
- [x] R13: TEXT THAT MUST REMAIN SELECTABLE
- [x] R14: HOSTS EDITOR — UNDO
- [x] R15: HOSTS EDITOR — REDO
- [x] R16: HOSTS EDITOR — RESTORE LOADED CONTENT
- [x] R17: HOSTS FILE RECOVERY
- [x] R18: HOSTS EDITOR BUTTON FLOW
- [x] R19: REVIEW CHANGES
- [x] R20: HOSTS SAVE
- [x] R21: AUTOMATIC HOSTS MANAGEMENT REMAINS RESTRICTED
- [x] R22: FIRST-RUN BACKUP IMPORT — COMPLETE RESTORE
- [x] R23: BACKUP MANIFEST
- [x] R24: BACKUP IMPORT RECONCILIATION
- [x] R25: NEW ITEMS
- [x] R26: IDENTICAL ITEMS
- [x] R27: CHANGED / CONFLICT ITEMS
- [x] R28: APPLY TO ALL
- [x] R29: DATABASE CONFLICTS NEED SPECIAL CARE
- [x] R30: DATABASE USER / ROLE / GRANT RECONCILIATION
- [x] R31: TRANSACTIONAL RESTORE
- [x] R32: BACKUP IMPORT PROGRESS UX
- [x] R33: BACKUP IMPORT SUMMARY
- [x] R34: SERVER-NEUTRAL RESTORE
- [x] R35: NATIVE CONFIGS ARE DERIVED
- [x] R36: PRESERVE UNSUPPORTED SOURCE INFORMATION
- [x] R37: ONBOARDING RESTORE FLOW
- [x] R38: DO NOT DUPLICATE DATABASE DATA
- [x] R39: DO NOT DUPLICATE SITES
- [x] R40: EXTERNAL SITE ROOTS
- [x] R41: DATABASE PASSWORDS
- [x] R42: PRIVACY AUDIT
- [x] R43: LOCAL DATA PRINCIPLE
- [x] R44: PRIVACY DOCUMENTATION
- [x] R45: LIGHTWEIGHT REQUIREMENT
- [x] R46: HOSTS EDITOR MEMORY
- [x] R47: BACKUP COMPARISON PERFORMANCE
- [x] R48: TRAY PERFORMANCE
- [x] R49: TEXT SELECTION PERFORMANCE
- [x] R50: COMPLETE PREVIOUS WORK TOO
- [x] R51: TEST ACTUAL USER FLOWS
- [ ] R52: PLATFORM TESTING — native macOS tray/menu/window/renderer passed; actual protected administrator prompts, Windows/Linux and signed/licensed environments remain unavailable.
- [x] R53: HEAVY TESTS SEQUENTIALLY
- [x] R54: UPDATE PERSISTENT DOCUMENTS

---

# Persistent database/runtime phase — local implementation complete 2026-09-29

Expanded locally implementable acceptance passed; detailed evidence and inherited external platform/release boundaries are in VHOSTRA_EXECUTION_STATE.md. Historical sections below remain superseded where they describe the old architecture.

- [x] Independent MariaDB lifecycle and host data/config/logs; safe existing-data handover/series compatibility.
- [x] Actual database/users/localhost accounts/roles/grants/credentials survive PHP, server and combined switches; no copied datadir candidates.
- [x] WordPress imported SQL with DB_HOST=localhost; mysqli/PDO localhost and 127.0.0.1; phpMyAdmin authentication.
- [x] SQL streaming import/export; sanitized failures; success/failure 6-second DESIGN-compatible alerts.
- [x] Extension intent/compatibility errors, OPcache, Redis/Memcached actual connectivity/config persistence, disabled daemon absence, cwebp and other Site settings.
- [x] Keep/Remove GUI/CLI reset semantics and confirmations; external roots untouched; independent/all CLI status/start/stop/restart.
- [x] Independent Services status/control; Resources separate DB/Web attribution, cached storage and visible-only work.
- [x] Dynamic tray visibility; hidden in-window menubar; native/explicit Quit dialog, Cancel, keep/stop and preference-driven title Close.
- [x] Local bounded Dashboard viewport previews, missing/stale triggers, explicit refresh, fallback, private cache and cleanup.
- [x] Privacy audit; full-file manual Hosts regression; existing queue review; migration with independently running/stopped DB.
- [x] Production build/unit/native UI/sequential live tests, resource measurements, visual DESIGN review, docs and exact cleanup.

---

# Vhostra completion checklist (internal)

- [x] Verify real cwebp enablement in the active Vhostra runtime (installed `webp`; `cwebp 1.5.0` reported by CLI).
- [x] Verify repository-derived LSPHP catalog and one optional lifecycle operation against the active runtime (APCu install/enable is reported by the HTTP PHP module endpoint).

- [x] Visually validate compact, transparent service artwork in light and dark themes; replace any remaining wordmark treatment.
- [x] Validate MariaDB dark-theme contrast in the rendered Electron UI.
- [x] Create, package, and validate a transparent, padded native tray asset (packaged 1x/2x resources and native macOS alpha/bounds acceptance).
- [x] Implement complete dynamically discovered LSPHP extension catalog and lifecycle operations (repository metadata, live module state, IPC/UI actions, disable/enable verification, and persisted APCu restoration across a Vhostra runtime restart).
- [x] Integrate hosts-file mapping state, retry/repair, and owned-mapping updates into every vhost workflow.
- [x] Audit and complete equivalent Services UI, CLI, and tray operations.
- [x] Validate dedicated Quit workspace and native close-policy behavior (native keep/stop exit, minimize process survival, shared stop/failure coverage; original preference restored).
- [x] Validate configuration-path migration recovery and UI feedback (isolated live database preservation, final PHP health failure rollback, source runtime recovery, and refreshed location feedback).
- [x] Validate phpMyAdmin automatic authentication and all real database operations (isolated live create/list/import/export/check/delete and migration persistence).
- [x] Implement and validate Apache/Nginx selected-runtime behavior and rewrite support.
- [x] Implement and validate transactional candidate runtime replacement across server/PHP changes.
- [x] Validate custom-port/HTTPS conflict behavior against live host state.
- [ ] Validate startup integrations across supported platforms. Implementation and platform-contract tests passed (Linux XDG lifecycle/quoting; macOS/Windows native API verification/refusal). [BLOCKED: native environment unavailable — implementation complete, acceptance pending] Windows/Linux login launches and an approved/signed macOS build are still required; this development Mac previously denied registration.
- [x] Validate offline Help, bounded Logs, About/update neutral state, privacy, welcome page, app/tray/favicon packaging.
- [x] Complete TODO/placeholder/dummy/mock audit and final DESIGN.md visual audit (no production TODO/dummy/mock implementations; input placeholders and documented screenshot/parser/external-restore limitations are intentional).

New functional audit queue (2026-09-27):
- [x] Correct operation-aware port ownership using exact managed Compose scope and structured bindings; retain external-conflict protection.
- [x] Gate all Electron initialization on early single-instance lock; validate second launch restores hidden/minimized window and one tray.
- [x] Implement bounded live backend operation output, candidate forwarding, and secret redaction.
- [x] Add active-operation-only expandable terminal, Roboto Mono, accessible scrolling and theme support.
- [x] Complete safe hosts writes: concurrency protection, atomic replacement, backups, elevation exit verification, all native implementations.
- [x] Audit create/import/edit/aliases/delete/repair/migration, collisions, cancellation and truthful mapping states.
- [x] Re-audit extension/services/CLI/database/server/runtime/desktop/packaging vertical behavior and visible production controls.
- [x] Run affected targeted checks, then comprehensive local final validation; record unavailable native acceptance separately.

- [x] Fix fresh PHP 8.1–8.4 OPcache package/module loading and verify enabled/disabled restoration; PHP 8.5 may supply it built in. Fresh 8.3/8.4 and persisted OPcache toggle acceptance passed.

Final validation renewed (2026-09-27):
- Production desktop/welcome/Electron/preload build and **35/35 automated tests passed**.
- Actual Electron two-launch acceptance passed: losing launch exits; one retained window/tray; hidden/minimized window restored and focused.
- Native compiled terminal passed actual Docker progress, active-only Expand, redaction, scrolling/follow, local Roboto Mono, Light/Dark/System, and 860px minimum width. Screenshots inspected.
- Native desktop migration IPC passed one progress session, real copy/verification/switch/removal stages, mutation guard, verified location and completion cleanup. Fixed the background welcome-write race found during acceptance.
- Final isolated server suite passed OLS/Apache/Nginx, rewrites, custom ports/TLS and protected external conflicts; PHP 8.3→8.4 promotion retained database; Redis/Memcached CLI/controller lifecycle and forced promotion rollback passed.
- Final isolated database/phpMyAdmin/migration suite passed SQL operations, automatic authentication, Supervisor operations, data-preserving migration and recovery.
- Live extension suite passed APCu install/disable/enable/remove and persisted restoration, actual OPcache toggles, dynamic catalog and cwebp.
- Final source-review MySQL/PDO protection/identity and ionCube loader normalization fixes passed a renewed build and the same 35/35 suite.
- Native bridge/tray/artwork passed; artwork and terminal screenshots inspected. CLI help, shell/JS syntax and git diff --check passed.
- Existing runtime's 80/9080/3306/443 ownership verified read-only. Only exact test scopes were created/removed; no unrelated Docker resources were changed. No commit made.

External acceptance, not passed or hidden as implementation work:
- [ ] Native Windows/Linux protected-host prompts, OS hosts mutation and login launch. [BLOCKED: native environment unavailable — implementation complete, acceptance pending] Platform command/write-plan/cancellation tests passed; these do not substitute for native UAC/pkexec acceptance.
- [ ] macOS mutation of the actual protected `/etc/hosts` and cancellation through the real administrator prompt. [BLOCKED: interactive administrator authorization required — implementation complete, acceptance pending] The osascript command's write plan was executed against temporary files with atomicity/concurrency/metadata checks; no real system hosts file was modified during testing.
- [ ] Signed installer and real release/update endpoint acceptance. [BLOCKED: release environment unavailable — packaging configuration and local assets implemented, signed release acceptance pending] No signing credentials or production release endpoint are configured.
- [ ] Windows/Linux native title-bar and window-manager acceptance. Native flags and best-effort Linux reversal are implemented; these environments are unavailable locally.
- [ ] Licensed LiteSpeed Enterprise runtime acceptance. Compatible Apache/OLS text conversion passed locally; licensed binary and proprietary XML behavior require the relevant external environment.

Detailed evidence: `VHOSTRA_FUNCTIONAL_AUDIT.md`. Unexposed README roadmap capabilities are explicitly separate from the implemented controls and this queue.

New development phase (2026-09-28; renewed local acceptance passed):
- [x] Canonical JSON import: Apache, Nginx, OLS and Enterprise-compatible formats; bounded parsing, preview, validation, preserved unsupported source and truthful findings.
- [x] Host-native generated configs: event-driven regeneration, transactional switch/rollback and positive-ownership old-config cleanup.
- [x] First-run welcome/theme/server/PHP/cache/review; real setup progress, retry and upgrade detection.
- [x] Hosts vertical re-audit: imports, aliases, collisions, protected writes and repair/reconciliation.
- [x] Localhost Light/Dark/System selection with matching icons and dynamic OS updates.
- [x] Visible-only Resources tab; scoped CPU/RAM and cached accurately labeled storage.

Historical window-controls decision was insufficient; the implemented and locally verified behavior is recorded in requirement 46 below.

- [x] Previous requirement and production placeholder audit; final build/unit/native/sequential runtime acceptance.


Renewed production build and 53/53 automated tests passed. Sequential server/import/rollback, actual onboarding runtime, extension, migration and performance suites passed; native UI/terminal/bridge/tray/session/dev/packaged checks passed. Native OS/release boundaries above remain unchecked; Enterprise licensed binary/XML acceptance is outside the compatible text conversion supported in this phase. See the 2026-09-28 functional audit and performance samples.

## Host storage and completion phase — reopened 2026-09-28

Earlier completion statements apply to their previous scope only. Current checked items have renewed source/UI/backend/host/runtime evidence in the functional audit; final sequential server validation passed. Native external acceptance remains unchecked above.

- [x] 1. REMOVE "CHOOSE LITESPEED DIRECTORY"
- [x] 2. FUNDAMENTAL STORAGE ARCHITECTURE
- [x] 3. SITE DOCUMENT ROOTS MUST BE HOST DIRECTORIES
- [x] 4. NEVER DELETE SITE ROOT DATA DURING CONFIGURATION REMOVAL/RESET
- [x] 5. HOST-SIDE VHOST CONFIGURATION
- [x] 6. NATIVE CONFIGURATION SWITCHING
- [x] 7. IMPORTED VHOST CONFIGURATION
- [x] 8. ACCESS AND ERROR LOGS
- [x] 9. IMPORTED LOG PATHS
- [x] 10. NEW SITE LOG LOCATIONS
- [x] 11. LOGS AREA
- [x] 12. CONSOLIDATE SITES + VIRTUAL HOSTS
- [x] 13. EDIT EXISTING SITE/VHOST
- [x] 14. HOSTNAME EDIT MUST UPDATE HOSTS
- [x] 15. ALIAS EDIT MUST UPDATE HOSTS
- [x] 16. COMPLETE HOSTS FILE EDITING
- [x] 17. HOSTS FILE UI
- [x] 18. HOSTS ELEVATION
- [x] 19. AUTOMATIC HOSTS MAPPING
- [x] 20. HOSTS REPAIR
- [x] 21. WELCOME PAGE THEME
- [x] 22. LOCALHOST THEME CONTROL MUST BE A TOGGLE
- [x] 23. ONBOARDING THEME PERSISTENCE
- [x] 24. WELCOME/ONBOARDING BACKUP IMPORT
- [x] 25. BACKUP IMPORT WORKFLOW
- [x] 26. BACKUP IMPORT ONBOARDING FLOW
- [x] 27. NORMAL ONBOARDING FINAL STEP
- [x] 28. RESET APP — SETTINGS
- [x] 29. RESET — VHOST CONFIGURATION CHOICE
- [x] 30. RESET MUST NEVER DELETE SITE ROOT FILES
- [x] 31. FINAL RESET CONFIRMATION
- [x] 32. RESET CANCEL
- [x] 33. RESET IMPLEMENTATION
- [x] 34. CLI RESET COMMAND
- [x] 35. SERVER + SERVICES UI CONSOLIDATION
- [x] 36. MOVE SERVER STATUS INTO RESOURCES
- [x] 37. RESOURCES
- [x] 38. COMPLETE CLI IMPLEMENTATION
- [x] 39. SPECIFIC RUNTIME STATUS
- [x] 40. ALL RUNTIME CONTROL
- [x] 41. SPECIFIC SERVICE CONTROL
- [x] 42. AUDIT ALL PREVIOUS CLI REQUIREMENTS
- [x] 43. PRIVILEGE MODEL
- [x] 44. PRIVACY — NO PERSONAL/SENSITIVE DATA COLLECTION
- [x] 45. LIGHTWEIGHT REQUIREMENT
- [x] 46. TITLE BAR MAXIMIZE / FULLSCREEN
- [x] 47. FULL FUNCTIONAL COMPLETION AUDIT
- [x] 48. SEARCH FOR INCOMPLETE PRODUCTION IMPLEMENTATION
- [x] 49. DO NOT DECLARE COMPLETE JUST BECAUSE TESTS PASS
- [x] 50. VALIDATION
- [x] 51. EXTERNAL TESTS
- [x] 52. EXECUTION BEHAVIOR

Current evidence groups: 1–7 host mount/storage + server/import suites and root-picker UI; 8–11 actual Site logs and bounded selector/rotation; 12–20 native/live edit/aliases/Hosts + cancellation/manual editing; 21–27 new/backup setup + theme/reload/final gate; 28–34 native/live Keep/Remove/CLI/reset root preservation; 35–42 actual Supervisor/health/CLI/Resources; 43–44 code privilege/network/privacy audit; 45 PERFORMANCE renewed samples; 46 native flags/limits; 47–49 fresh vertical matrix/production search; 51 explicit external environment boundary. 50/52: production build and 66/66 automated tests passed; native renderer/IPC and lifecycle checks, sequential real Docker suites, final screenshot inspection, resource measurements, scoped cleanup and final cursor update completed. No locally implementable item remains open in this 52-requirement phase. External acceptance above remains unchecked; implementation was completed without a commit. The user subsequently authorized commit/push and requested the README light logo and Dashboard screenshot, which are included.


## Manual Hosts editor correction — completed 2026-09-28

- [x] Automatic Site/alias/delete/repair management remains ownership-restricted, with a separate native-write guard and unrelated-entry regression coverage.
- [x] Explicit manual editor allows full-file editing, validates syntax, identifies/warns for owned mappings, shows a bounded diff and requires exact reviewed Save confirmation.
- [x] Race detection before review/save and during approval; reload preserves the previous draft for user review/merge.
- [x] Scoped native elevation, private backup, atomic write, verification and guarded recovery; cancellation leaves the protected file unchanged.
- [x] Recalculate missing/conflicting Site mappings after successful edits; Repair stays explicit and does not overwrite unrelated conflicts.
- [x] Production build, 78/78 automated tests and renewed native production UI/IPC workflow passed; dark review screenshot inspected. Real protected prompts remain external acceptance. The user subsequently approved committing and pushing the follow-up changes.

## Database accounts / localhost / error UX phase (2026-09-29)

This additive phase continues the existing repository and preserves the earlier queue. See [database architecture and acceptance](docs/database-access.md). No Git commit, real Site mutation, protected Hosts write, global Docker prune or unrelated Docker change was performed.

- [x] D01–D03 / request 1–3, 7–11, 37–38, 44: reproduce legacy localhost account shadowing and partial duplicate creation; preserve the real separate-container socket gateway; default new accounts to localhost; verify mysqli/PDO socket/TCP, exact CURRENT_USER, database access and writes before success. Actual official WordPress DB_HOST=localhost passed.
- [x] D04–D06 / request 4–6, 12–14, 32–36: exact User@Host preflight and separate visible host identities, filtered existing selector + Custom, password/real validated Host, least database-specific grants, existing account/password preservation, grant/role/global summaries, Check/Update Database Access and explicit password change with failure recovery. Database duplication is checked before mutation.
- [x] D07 / request 15–16: real renderer→IPC→MariaDB creation updates the database row and account option immediately from refreshed backend inventory; extra Refresh is available. No restart, tab switch or polling.
- [x] D08 / request 17–27: shared simple errors, collapsed structured details, reliable file/line extraction and mounted-host path mapping, central secret redaction, preserved sanitized unknown errors, six-second database success and persistent dismissible failure. No invented diagnostic locations/causes.
- [x] D09 / request 28–31, 45–46: default CSS is unselectable per element; copyable semantics no longer derive from monospace typography or ARIA roles. Label/heading/navigation/control audit passed on Dashboard, Sites, Services, Resources, Database, Logs, Settings, Help, onboarding, Reset/Quit dialogs and error details. Values/paths/output and native editable inputs retain selection, replacement, undo and redo.
- [x] D10 / request 39–42: production dependencies/network/IPC/storage reviewed; no tracking/upload/telemetry or new dependency. Credentials are temporary, backend SQL/PHP use stdin, plaintext is not stored, authentication clauses/hashes remain in private backend backup payloads. Queries/probes run only on demand/mutation, with bounded output and no new timers.
- [x] D11 / request 43, 47–48: architecture documented and all four completion/performance records updated. Earlier platform/release/licensed-runtime boundaries remain open. The old SHOW CREATE USER single-column export gap was reopened, corrected, unit-tested and validated through actual password rollback; actual backup reconciliation and persistence regressions passed.

New acceptance: production build `/private/tmp/vhostra-db-build.log`; **99/99** regression tests `/private/tmp/vhostra-database-unit.log`; live account/WordPress `/private/tmp/vhostra-database-access-live.log` (exit 0); native real SQL UI `/private/tmp/vhostra-database-access-ui.log` (exit 0). Initial failure repro is `/private/tmp/vhostra-db-reproduction.log`. Final native fixture cleanup/inventory verification passed. Prior persistence, full backup reconciliation and desktop regressions also passed; final logs and preserved environment boundaries are recorded in the execution state.

## Visual readiness and notice correction (2026-09-30)

- [x] README now states that Vhostra grants no software license; Enterprise is documented as configuration import only.
- [x] First preview capture waits for bounded document/font/visible-image/layout readiness; no idle observer or network-idle requirement is introduced.
- [x] Isolated real runtime verified automatic first localhost and named previews on Nginx, then sequential Apache/OpenLiteSpeed routing, HTTP/HTTPS/custom ports and cleanup.
- [ ] Packaged desktop artifact notice contents and the complete WordPress/plugin visual matrix require further verification; configuration and fixture review alone do not close these checks.

## Named Site preview phase (2026-09-29)

- [x] P01 (1–7, 21, 40–42): traced/reproduced legacy bare-loopback navigation; central canonical/alias resolver, exact live vhost marker, named Host/SNI/browser navigation and default-vhost separation. Literal reported ERR_INVALID_ARGUMENT did not reproduce; no invented cause is claimed.
- [x] P02 (8–10, 44–45): read-only Hosts checks, configured protocol/ports, canonical-first valid alias fallback, local SAN-valid certificate handling without global TLS bypass; existing scoped Repair Site action.
- [x] P03 (11–20, 43, 46): private/local hidden first-viewport capture, both scrollbars suppressed only in capture CSS, bounded DOM/render/navigation deadlines, stopped fallback and resource cancellation/cleanup.
- [x] P04 (22–27, 30, 32–35): bounded atomic host JPEG cache; per-Site refresh/deduplication; one sequential capture window; visibility gating; routing/used-alias invalidation; PHP/server/unused-alias preservation; previous image retained on failure.
- [x] P05 (28–31, 49–50): DESIGN-compatible simple fallback and Repair action; collapsed sanitized technical details; actual selectable Preview URL value and unselectable labels/controls.
- [x] P06 (36–39, 47–48): no upload/telemetry/new dependencies or idle polling; local repeated-capture CPU/RAM/process evidence; no retained screenshot renderer or accumulation of capture windows.
- [x] P07 (51–52): build/full contracts/native UI/actual all-server preview acceptance; persistent documents updated; previous acceptance queue audited and retained. No new Git commit.
- [ ] Inherited native Windows/Linux, protected administrative prompts, signed/login/release and licensed Enterprise acceptance still require their recorded environments. This phase does not mark those boundaries complete.

Detailed evidence and diagnosis: `docs/site-previews.md`. Original database/runtime/privacy/selection work remains in the repository.

## Service/database UX phase — reopened 2026-09-30

- [x] Shared stopped/failed mapping and Dashboard runtime-status colon; isolated actual stopped, independent running, and occupied-port failed-start acceptance passed.
- [x] Exact User@Host Change Password and confirmed Delete controls; live account/host-variant and renderer acceptance passed. Accounts with global privileges or roles are protected.
- [x] Reusable Show/Hide Password on all current database-entry fields; native hidden/reveal/hide and unchanged-value acceptance passed.
- [x] Database operation result scroll in the content pane; native completion assertion passed.
- [x] Explicit database dependency and pending-import metadata; pre-render preview gate; matching event-driven readiness; real PHP/SQL first-preview acceptance passed.
- [x] Sequential local service, account, preview, scroll, privacy-source and scoped CPU/RAM/storage acceptance. Evidence and limits are in VHOSTRA_EXECUTION_STATE.md and PERFORMANCE.md.
- [x] Delete scope is the isolated Vhostra-owned MariaDB instance; exact User@Host confirmation, grant summary, named internal-account protection and global privilege/role refusal are verified. Origin-tool provenance for ordinary accounts is not recorded; optional registry hardening is documented in VHOSTRA_EXECUTION_STATE.md.

2026-09-30 continuation: explicit Site database association, pending SQL-import state, pre-render MariaDB/database availability gate and import event have now been implemented; focused persistence test passed. The unchecked gate above remains open for native first-preview and resource acceptance.

## Required fixes continuation (2026-09-30)

- [x] Diagnosed phpMyAdmin restriction from actual account/grants/config and phpMyAdmin controller: `vhostra_pma` is a dedicated `mysql_native_password` account with global administrative grants; phpMyAdmin defaults `AllowUserDropDatabase` to false for non-superuser UI. Enabled the setting and verified isolated HTTP create/import/export with structure and data/browse/alter/drop and account/grant operations against real MariaDB. The export page initially failed because PHP cURL was absent; it is now a required runtime extension.
- [x] Database actions render under every name, including short, medium and long fixtures; geometry and light-theme screenshot inspected.
- [x] First-run Local Configuration Path step has canonical prefilled root, editable input, native Browse, exact selected-root migration through the existing verified copy/pointer transaction. The selected existing empty folder now works through a verified sibling staging copy. Native Continue, invalid relative-path rejection, renderer reload and new-store pointer persistence passed in an isolated Docker scope.
- [x] Logs now has source selection, bounded file list and on-demand 64 KiB viewer with selectable path/output; empty and loaded real-log states plus light/dark surface screenshots inspected.
- [x] Backend publishes MariaDB Starting on actual Compose startup, preserves Stopped after an intentional stop, and reports an isolated genuine failed start. Selected frontend/cache Starting state uses real Compose/Supervisor operations and a bounded revision event.
- [ ] Security closure: the dedicated phpMyAdmin account still has global `ALL ... WITH GRANT OPTION`. phpMyAdmin's database-destroy controller excludes built-in schemas, but SQL and account operations can still reach internal objects. A MariaDB-level isolation design is required before claiming internal system objects are fully protected.
- [ ] Isolate phpMyAdmin administrative credentials from arbitrary Site PHP within the shared runtime. The existing config/env architecture keeps them out of renderer/URL/logs but is not a security boundary against local Site code in the same container.
- [x] Native Logs acceptance covered a real 73 KiB file with a 70,000-character line and 500 further lines, the 64 KiB tail/truncation notice, wrapping at the 860 px minimum window, and a removed-file read error with selectable diagnostic text. The narrow screenshot was inspected.
- [ ] Complete actual system-theme Logs check, full Electron process restart after a selected configuration path, and backup-import onboarding interaction under an isolated desktop profile.
- [ ] Verify all represented service transitions including safe actual failure cases for web/cache/PHP/phpMyAdmin. Matched pre/post-cURL isolated Nginx/MariaDB and clean packaged Electron idle samples are recorded in PERFORMANCE.md; broader platform and workload budgets remain open.

## Lifecycle and export continuation — 2026-10-01

- [x] Independent MariaDB Starting, Stopping, Running, Stopped and genuine failed-start transitions passed against an isolated container; no real stop remains labelled Running.
- [x] Sequential shared Nginx/MariaDB Start, Stop and Restart acceptance passed, including direct backend transition events, Docker process timestamps, healthy final states and exact resource cleanup. Individual web Stop/Start also passed with PHP Stopped after frontend shutdown. A transient web Stopped event during startup was found and fixed before the final run.
- [x] Add Site no longer shows Framework or Associated database. Native UI verified the remaining form and read-only Site config export; Site save and native-vhost import show the database reminder through their success notice paths.
- [x] Apache, Nginx and OpenLiteSpeed per-Site exports use the canonical host and existing generators on demand; the isolated runtime fixture checked each structure and unchanged canonical state. Unsupported imported directives are marked Requires review and left inactive.
- [x] Generic local production database export uses the existing streamed MariaDB dump, validates destination inputs and exports SQL unchanged. Native UI verified the form and local save. No WordPress-specific conversion or raw SQL replacement is performed.

- [x] README states local development only, explains production hosting/SSL limits, and preserves the no-Vhostra-license notice.
- [x] Isolated native UI created a Site, imported an Apache vhost, displayed both database reminders at the top of the scrolled content pane, preserved the source, and did not fabricate databases.
- [x] Isolated MariaDB exported over 1 MiB of SQL with serialized-style content unchanged and rejected an invalid destination. Native UI cancellation performed no dump; an invalid destination and a Save target inside active Vhostra configuration were rejected before writing.
- [x] Optional-service state contract confirms Starting before enable, Stopping during disable even after the setting changes, and Disabled after completion; disabled caches do not appear Restarting in the full runtime fixture.
- [ ] WordPress-aware conversion, actual optional cache/web/phpMyAdmin failure transitions, and matched post-change CPU/RAM/peak-dump-memory measurements remain to be verified. Production export intentionally leaves WordPress data unchanged until a serialization-safe conversion strategy exists.

## Vhost identity and Database UI continuation — 2026-10-01

- [x] The canonical `VirtualHost.hostname` and `aliases[]` persist through Add/Edit and a fresh store load. Site details and the Add/Edit form display the canonical primary value; Site URL candidates continue to try that value first. Hosts reconciliation and preview routing consume the same canonical fields.
- [x] Apache `ServerName`/`ServerAlias`, Nginx `server_name`, OpenLiteSpeed listener `map` entries and supported Enterprise text import preserve a primary name plus multiple aliases. Conversion tests cover every imported source to all three export targets. OpenLiteSpeed folder export contains a real listener, virtual-host declaration and separate vhconf, and was reimported both directly and through the Electron export handler.
- [x] Live isolated Docker requests for the canonical name and both aliases reached the same Site under OpenLiteSpeed, Apache and Nginx. The existing sequential server acceptance also passed server switches, PHP replacement and rollback with canonical JSON unchanged. The focused test cleaned its own Docker containers.
- [x] Removed Database Access from database cards. The production export form retains an explicit required selector and clears a stale choice when the database list changes. Electron UI assertions and light/dark screenshots verified actions below short and long names, with no card shortcut or dead action gap.
- [x] No new telemetry, hostname upload, background conversion, polling loop or export cache was introduced. Import reads only a selected LiteSpeed main file and its referenced local vhconf files; export runs on demand. Measured bounded in-process conversion and limitations are recorded in PERFORMANCE.md.
- [ ] Validate the exported OpenLiteSpeed folder with a separate native OpenLiteSpeed installation outside Vhostra after adapting runtime mount/certificate paths; the in-app native server and folder round trip are verified. Existing unrelated completion gaps remain pending.

## Unified Site files and dialog location — 2026-10-01

- [x] One authoritative managed Site JSON embeds hostname, aliases, root, supported settings and import metadata; native server files remain derived.
- [x] Legacy Apache, Nginx, OpenLiteSpeed and Enterprise imported split records consolidate with identity/root/alias checks and an owned recovery copy; startup is idempotent.
- [x] OpenLiteSpeed exports one portable Site file, and Site import accepts it; Apache/Nginx native exports remain single files.
- [x] All main-process native file/save/folder dialogs use one local last-directory preference with cancellation and missing-directory fallback.
- [x] Native restart/fallback dialog acceptance and migrated OpenLiteSpeed routing under all three servers on this Mac.
- [ ] Windows/Linux native dialog and release-package acceptance.

## Help and CLI documentation — 2026-10-01

- [x] Replaced the brief Help summary with local, plain-language topics for onboarding, services, Sites, Databases, PHP/caches, Hosts, Logs, settings/backup/reset, CLI, troubleshooting and privacy. Checked user-facing CLI command groups against `scripts/vhostra.mjs` and actual CLI help.
- [x] Help title/description, all headings, topic navigation and controls remain unselectable. Documentation prose and command/output examples use explicit selectable semantics. Each CLI code block has Copy/Copied feedback.
- [x] Existing local search retained; static topic text and command names are searched while Help is mounted. Empty query shows navigation, no match shows a simple message, and Clear resets the query. No search persistence, request or indexing process was added.
- [x] Build and 116/116 repository tests passed with local loopback permission. An isolated `npm run cli -- help` matched the documented syntax. An isolated Electron fixture verified computed text-selection styles, search terms/empty/clear behavior, zero Help search requests, Copy/clipboard, focus and light/dark and 860px-width visuals.

## Help tabs, fixed window and CLI correction — 2026-10-01

The command coverage and remaining live cases are recorded in [VHOSTRA_CLI_TEST_MATRIX.md](VHOSTRA_CLI_TEST_MATRIX.md).

- [x] Help renders one horizontal, keyboard-accessible tab panel at a time. Search ranks local matches across all topics, selects a category and offers other matching categories. Body and code remain selectable; headings and controls remain unselectable.
- [x] README and Help distinguish local Site/vhost configuration export from separate SQL Database Production Export, including manual production adaptation.
- [x] The main window selects a fixed size within its display work area and disables manual resize, maximize and fullscreen. Narrow content can scroll and the sidebar condenses below 720px.
- [x] Build and sequential 119/119 unit tests passed. CLI parser families received explicit syntax validation and local help; default output uses readable text. Database commands check MariaDB state before SQL, and a missing container is Not Created. Isolated tests cover all six database verbs with MariaDB absent, family help, invalid syntax, formatter and redaction.
- [x] README and Help no longer claim that desktop packaging installs a system-wide CLI launcher.
- [x] Isolated macOS Electron fixture verified all 11 tabs, one panel, arrow-key navigation, MariaDB search selecting Databases, local-only search, selection/copy, themes and fixed-window flags/bounds after a sandboxed LaunchServices abort was resolved by running the fixture outside the command sandbox.
- [ ] Windows/Linux window-manager and small-display native acceptance.
- [ ] Full live Docker CLI success/failure matrix for every mutating command, including running/stopped MariaDB, disabled caches, real errors and clean exit. A sequential isolated MariaDB fixture now verifies real CLI database list/status while Running and a clear nonzero database-list error while Stopped, plus exact Docker inventory cleanup. Other live paths remain unverified.
- [ ] Release packaging and a cross-platform installed CLI launcher. The npm bin mapping is not an installed desktop command.

## Runtime/settings/service/CLI/startup follow-up — 2026-10-01

- [x] Settings selectors and cache checkboxes show the requested value immediately, display action-derived pending labels, and roll back after an injected backend failure; the web-server icon changes with the request. A native Electron fixture also verified final Runtime Status scrolling.
- [x] The old generated Memcached config in the reported profile lacked its run-as-user flag; its log said Memcached refused to start as root. Missing `-u nobody` and private loopback flags are now repaired while existing local config/comments are preserved. An isolated live runtime passed both cache PHP localhost checks.
- [x] OpenLiteSpeed PHP 8.5→8.4→8.5 and a cold PHP 8.2 candidate passed in isolated scopes; the final 8.4→8.5 fixture found 72 extension catalog entries, loaded Redis/Memcached, passed both PHP localhost checks at each version, and removed its exact test scope. The existing three-server fixture passed routing, database survival, cache lifecycle, and injected rollback.
- [x] Help tabs wrap without horizontal scrolling; local search/keyboard/copy passed in Electron. The redundant Settings Appearance selector is removed.
- [x] Fresh profiles enable start-on-open; Settings and Welcome expose three shared startup preferences. Native login-item argument registration has unit coverage and the Welcome UI passed.
- [x] A local unsigned `Vhostra.app` package includes `Contents/Resources/bin/vhostra`; isolated packaged CLI help, all service status targets, prerequisite and syntax tests run from outside the checkout without npm. The final app archive is 3.8 MB and the unsigned bundle is 305 MB.
- [ ] The historical apt exit-100 log contains only BuildKit's long command, so its first failing package/repository line cannot be recovered. The current cold build passed; separate build layers and concise future diagnostics are implemented.
- [ ] Apache/Nginx still run the selected LSPHP package's CLI development backend, rather than an independent normal PHP-FPM package. Architecture correction and all-version native acceptance remain open.
- [ ] Complete the remaining live CLI mutation matrix and Windows/Linux native package/login acceptance. A PATH entry is not installed automatically by the app package.
- [ ] Measure matched idle CPU/RAM and full runtime/storage deltas, and verify startup after a real OS login.
