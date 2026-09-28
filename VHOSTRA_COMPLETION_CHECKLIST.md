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
