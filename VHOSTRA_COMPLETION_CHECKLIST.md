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

Detailed evidence: `VHOSTRA_FUNCTIONAL_AUDIT.md`. Unexposed README roadmap capabilities are explicitly separate from the implemented controls and this queue.
