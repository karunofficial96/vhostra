# VHOSTRA — BACKUP RECONCILIATION, LOCALHOST SERVICES, TRAY AND UX COMPLETION

Continue the EXISTING Vhostra repository.

This is intentionally a NEW Codex chat.

The repository already contains substantial implementation from previous phases.

DO NOT START OVER.

DO NOT:

- reset/revert existing work;
- discard working functionality;
- delete user data;
- touch unrelated Docker resources;
- globally prune Docker;
- make a Git commit unless explicitly requested.

Everything must follow `DESIGN.md`, including exact spacing, typography, dialogs, controls, themes, icons, responsive states and accessibility.

Preserve the lightweight architecture and all previous performance improvements.

---

# 1. AUDIT FIRST

Before modifying code inspect:

- `git status`
- recent commits/diff
- `DESIGN.md`
- `VHOSTRA_COMPLETION_CHECKLIST.md`
- `VHOSTRA_FUNCTIONAL_AUDIT.md`
- `VHOSTRA_EXECUTION_STATE.md`
- `PERFORMANCE.md`

Also inspect current implementations for:

- tray lifecycle;
- minimize/minimize-to-tray;
- Electron menus;
- text selection;
- Hosts editor;
- onboarding;
- backup/import;
- canonical vhost JSON;
- server-specific configuration conversion;
- MariaDB persistence;
- Redis;
- Memcached;
- privacy;
- resource usage.

Do not trust old completion checkboxes without inspecting actual behavior.

Add every requirement from this prompt to the persistent completion queue.

---

# 2. REDIS DEFAULT APPLICATION HOST MUST BE LOCALHOST

When Redis is enabled, applications should be able to use:

`localhost`

as the default Redis host.

Also support:

`127.0.0.1`

where appropriate.

Because Redis remains inside the primary web/PHP runtime, configure it so PHP applications can connect locally without needing to know Vhostra's Docker implementation.

Do not require users to put a Docker container/service name into WordPress/CMS configuration.

Example desired application configuration:

Redis host:

`localhost`

Use the standard Redis port unless the user's Vhostra configuration explicitly changes it.

---

# 3. MEMCACHED DEFAULT APPLICATION HOST MUST BE LOCALHOST

When Memcached is enabled, applications should be able to use:

`localhost`

and appropriately:

`127.0.0.1`.

Do not require Docker-specific hostnames in user applications.

Use the standard Memcached port unless Vhostra explicitly supports/configures another one.

---

# 4. LOCALHOST MUST BE REAL, NOT JUST UI TEXT

Actually validate connectivity.

For Redis test an appropriate client/PHP extension using:

`localhost`

For Memcached test an appropriate client/PHP extension using:

`localhost`.

Do not merely display "localhost" in Settings while internally requiring another hostname.

---

# 5. PRESERVE CACHE CONFIGURATION

Redis/Memcached selections and applicable configuration must survive:

- app restart;
- web-server switch;
- PHP switch;
- combined server/PHP switch;
- primary runtime rebuild.

If the PHP version changes, restore/provision the corresponding supported PHP extension.

If disabled, the service must genuinely not run.

---

# 6. TRAY ICON DISAPPEARS — BUG

Current bug:

When Vhostra is:

- minimized;
- minimized to system tray;
- hidden to tray;

the system tray icon can disappear.

FIX THIS.

The tray icon is especially important while the main UI is hidden.

---

# 7. TRAY LIFECYCLE

The tray object must have an appropriate application-lifetime reference.

Do not accidentally garbage-collect/destroy it when the window:

- minimizes;
- hides;
- closes to tray.

Expected:

## UI visible

Tray icon may remain present according to Vhostra's established tray architecture.

The menu item:

**Open Vhostra**

must NOT be shown while the window is already visible.

## UI hidden/minimized to tray

Tray icon MUST remain visible.

Tray menu MUST contain:

**Open Vhostra**

Selecting it restores/focuses the existing window.

Do not create a second window or application instance.

---

# 8. MINIMIZE VS MINIMIZE TO TRAY

Respect the existing intended close/minimize settings.

Do not conflate:

- ordinary minimize;
- hide/minimize to tray;
- title-bar close;
- explicit Quit.

Whichever behavior is selected must be consistent.

Tray lifecycle must remain correct.

---

# 9. EXPLICIT QUIT

Preserve the previously requested explicit Quit behavior:

**Quit Vhostra and Keep Services Running**

**Quit Vhostra and Stop Services**

**Cancel**

Explicit Quit must fully exit Electron after the user's choice.

Title-bar Close continues following the user's configured close behavior.

---

# 10. REMOVE UNNECESSARY ELECTRON MENUS

Audit the current Electron menu bar.

I do NOT want unnecessary generic:

- Edit
- Window

menus presented merely because Electron supplies defaults.

Vhostra should not feel like an uncustomized Electron application.

Remove unnecessary default menus where platform behavior safely permits it.

---

# 11. macOS MENU CARE

Do NOT blindly remove required macOS application behavior.

The macOS application menu may retain appropriate native items such as the explicit Vhostra Quit action.

But remove generic/unnecessary menus that provide no useful Vhostra function where technically safe.

Do not break:

- text-field keyboard shortcuts;
- copy/paste where allowed;
- accessibility;
- explicit Quit behavior.

Keyboard editing should not depend on a visible generic Edit menu if Electron accelerators/roles can be provided appropriately without exposing that menu.

---

# 12. TEXT SELECTION POLICY

Most ordinary dashboard/UI text should NOT be selectable.

This includes typical:

- headings;
- labels;
- cards;
- navigation;
- descriptions;
- button text;
- ordinary status labels.

Use appropriate CSS such as user-selection rules rather than JavaScript hacks.

---

# 13. TEXT THAT MUST REMAIN SELECTABLE

Text should remain selectable where copying is genuinely useful.

At minimum:

- folder paths;
- file paths;
- configuration locations;
- runtime status/details where useful;
- runtime terminal/process output;
- errors;
- success messages;
- Help & Documentation content;
- server name;
- server aliases;
- log content;
- code/configuration content;
- Hosts editor;
- other explicitly editable inputs.

Text fields/textareas must remain fully editable/selectable.

Do not break copy/paste.

---

# 14. HOSTS EDITOR — UNDO

Inside:

**Edit Complete Hosts File**

add an appropriate:

**Undo**

control.

It should undo edits within the current editor session.

Use a proper editor/history model rather than modifying `/etc/hosts` immediately.

Undo before Save must not require admin privilege because the OS file has not yet changed.

---

# 15. HOSTS EDITOR — REDO

Add:

**Redo**

for current editor-session changes.

Enable/disable Undo and Redo truthfully according to history.

Use DESIGN.md controls/icons.

---

# 16. HOSTS EDITOR — RESTORE LOADED CONTENT

Provide:

**Restore Original**

or an equivalent DESIGN.md-appropriate label.

This restores the editor buffer to the Hosts content that was loaded when the editor session began.

It must NOT write the OS file until the user reviews and saves.

If the Hosts file changed externally since opening, detect that before saving.

---

# 17. HOSTS FILE RECOVERY

The existing safe Hosts-write architecture must maintain a recovery backup before an actual protected write.

Where appropriate expose:

**Restore Previous Hosts File**

for recovering the most recent valid Vhostra-created pre-write backup.

This operation DOES modify the protected Hosts file and therefore requires scoped system administrative privilege.

Locations:

macOS/Linux:

`/etc/hosts`

Windows:

`C:\WINDOWS\system32\drivers\etc\hosts`

---

# 18. HOSTS EDITOR BUTTON FLOW

A sensible editing flow should contain appropriately designed controls such as:

- Undo
- Redo
- Restore Original
- Restore Previous Hosts File
- Cancel
- Review Changes

Do NOT directly write the Hosts file from an ordinary typing action.

---

# 19. REVIEW CHANGES

**Review Changes** should show a clear diff/change summary.

Show:

- additions;
- removals;
- modifications;
- Vhostra-managed mapping changes;
- unrelated/manual mapping changes;
- comments changed.

Then allow:

- Back to Edit
- Cancel
- Save Changes

---

# 20. HOSTS SAVE

Only after explicit Save:

1. re-read native Hosts file;
2. detect external concurrent changes;
3. validate proposed content;
4. create recovery backup;
5. request scoped admin privileges;
6. write safely/atomically;
7. verify result;
8. refresh Site mapping state.

If authentication is cancelled:

do not modify Hosts.

Do not store credentials.

Do not run the whole Electron application elevated.

---

# 21. AUTOMATIC HOSTS MANAGEMENT REMAINS RESTRICTED

Do NOT weaken automatic vhost safety.

Automatic Site operations may modify ONLY positively identified Vhostra-managed Hosts entries.

Full-file arbitrary editing is permitted ONLY through the explicit manual Hosts editor.

---

# 22. FIRST-RUN BACKUP IMPORT — COMPLETE RESTORE

When first-time onboarding offers:

**Import existing Vhostra backup**

the backup workflow must understand all supported persistent state included in the backup.

This may include:

- Vhostra settings;
- canonical Site/vhost JSON;
- generated/native configuration metadata;
- Site definitions;
- MariaDB databases;
- database users;
- roles;
- grants/privileges;
- applicable database metadata;
- PHP extension preferences;
- Redis/Memcached state;
- other supported Vhostra configuration.

Do not silently omit database identities/permissions if the backup format claims to preserve them.

---

# 23. BACKUP MANIFEST

Use/version an appropriate backup manifest so Vhostra can understand what the backup contains without blindly restoring files.

The manifest should contain sufficient NON-SECRET metadata for:

- backup format/version;
- Vhostra compatibility;
- Site identities;
- canonical config identities;
- database identities;
- database-object presence;
- checksums/fingerprints where appropriate;
- settings/components included.

Do NOT place plaintext database passwords in an unnecessarily exposed manifest.

Secrets require appropriate local secure handling.

---

# 24. BACKUP IMPORT RECONCILIATION

Before restoring, classify every relevant item as:

- NEW
- IDENTICAL
- CHANGED / CONFLICT
- INCOMPATIBLE

Do this for appropriate:

- Site/vhost definitions;
- canonical JSON;
- database identities;
- database users;
- roles;
- grants;
- supported configuration;
- other restorable Vhostra state.

Do NOT blindly import everything.

---

# 25. NEW ITEMS

If an item does not exist locally:

import it.

Progress should truthfully say something such as:

`Importing example.test`

or:

`Restoring database example_db`

according to DESIGN.md progress patterns.

---

# 26. IDENTICAL ITEMS

If the same item already exists and is genuinely equivalent:

SKIP it.

Do not create:

- duplicate Site;
- duplicate vhost;
- duplicate database;
- duplicate database user;
- duplicate role;
- duplicate grant;
- duplicate generated configuration.

Progress should mention the skip.

Example concept:

`example.test already exists — skipping`

or:

`Database example_db already exists and matches backup — skipping`

Use concise DESIGN.md wording.

---

# 27. CHANGED / CONFLICT ITEMS

If an object with the same identity exists but differs from the backup:

DO NOT silently overwrite it.

Present a conflict-resolution step.

Clearly show:

- what exists locally;
- what is in the backup;
- what differs at a useful level;
- consequences of replacement.

Offer appropriate actions such as:

- Keep Existing
- Replace with Backup
- Skip

Where meaningful and safe, a merge option may exist, but do NOT offer fake merging for objects that cannot be safely merged.

---

# 28. APPLY TO ALL

For multiple conflicts of the same safe category, consider an optional:

**Apply this choice to remaining conflicts**

to avoid making the user answer hundreds of identical questions.

Do not apply a destructive choice across fundamentally different categories without clear consent.

---

# 29. DATABASE CONFLICTS NEED SPECIAL CARE

Do NOT determine database equality merely from database name.

A database called:

`wordpress`

may exist both locally and in the backup while containing different data.

Use backup manifest metadata/checksums where available.

Avoid performing extremely expensive full-database comparisons during every onboarding run.

If equality cannot be established confidently:

treat it as a conflict rather than claiming it is identical.

---

# 30. DATABASE USER / ROLE / GRANT RECONCILIATION

Similarly:

same username does NOT automatically mean identical account state.

Compare available safe metadata for:

- account identity;
- host scope;
- roles;
- grants/privileges;
- supported authentication metadata.

Do not expose password hashes/secrets unnecessarily in UI.

If uncertain, classify as conflict.

---

# 31. TRANSACTIONAL RESTORE

Backup restore should be as transactional/recoverable as reasonably possible.

Do not leave half-restored state silently after failure.

Track:

- imported;
- skipped;
- replaced;
- conflicted;
- failed.

Provide a final summary.

---

# 32. BACKUP IMPORT PROGRESS UX

During import show meaningful real progress.

Examples:

`Reading backup manifest…`

`Checking Site configurations…`

`example.test already exists — skipping`

`Restoring blog.test…`

`Checking database blog_db…`

`Database blog_db differs — review required`

`Restoring database users…`

No fake progress timers.

---

# 33. BACKUP IMPORT SUMMARY

After completion show a concise summary such as:

Imported      5
Skipped       3
Replaced      1
Conflicts     0
Failed        0

Use actual values.

If conflicts remain unresolved, do not claim setup is fully complete.

---

# 34. SERVER-NEUTRAL RESTORE

A backup must NOT lock the user permanently to the web server that created it.

Canonical Vhostra JSON is the portable source of truth.

Example:

Backup originally used Apache.

During onboarding user selects OpenLiteSpeed.

Vhostra should:

Apache backup/native information
→ canonical JSON
→ OpenLiteSpeed generated configuration.

Likewise support valid conversion among:

- Apache;
- Nginx;
- OpenLiteSpeed;

and supported LiteSpeed-compatible import information.

---

# 35. NATIVE CONFIGS ARE DERIVED

Do not blindly activate an old native `.conf` from a backup when the currently selected server differs.

Restore canonical Site configuration.

Then generate the correct native configuration for the selected server.

Native config files are derived/validated artifacts.

---

# 36. PRESERVE UNSUPPORTED SOURCE INFORMATION

If imported configuration contains server-specific directives that cannot safely convert:

do not silently discard them.

Preserve appropriate source metadata and show:

**Requires review**

or another DESIGN.md-compatible warning.

Do not inject incompatible Apache directives into Nginx, etc.

---

# 37. ONBOARDING RESTORE FLOW

Recommended UX:

Welcome

→ Import Existing Backup / Set Up as New

If Import:

Select Backup

→ Validate Backup

→ Compare Existing State

→ Resolve Conflicts if any

→ Restore

→ Generate configuration for selected/current server as required

→ Thank you for setting up Vhostra

→ **Start using Vhostra**

If the backup lacks a required current setting such as selected server/PHP, ask only for missing information.

---

# 38. DO NOT DUPLICATE DATABASE DATA

If an identical database already exists:

skip it.

Do not restore a second database under an arbitrary duplicate name unless the user explicitly chooses a separate-copy workflow.

Do not silently replace live data.

---

# 39. DO NOT DUPLICATE SITES

Use stable canonical identities where possible.

Do not determine duplicate Sites solely from display name.

Consider appropriate identity information such as:

- canonical Site ID;
- hostname;
- aliases;
- document root metadata;
- backup identity.

Handle hostname collisions explicitly.

---

# 40. EXTERNAL SITE ROOTS

Backup restore must never blindly overwrite external Site root directories.

If backup includes Site files and a target root already contains differing data:

treat that as a conflict requiring explicit user choice.

Never delete external root files simply because configuration is being restored.

---

# 41. DATABASE PASSWORDS

Do not expose passwords during backup conflict UI.

Do not log them.

Do not put them in progress output.

Restore credentials only through appropriate secure backend mechanisms.

---

# 42. PRIVACY AUDIT

Vhostra must not collect personal or sensitive user data remotely.

Audit production dependencies/code for:

- analytics;
- telemetry;
- tracking;
- crash uploads;
- remote logging;
- external screenshot services;
- remote configuration uploads;
- unique tracking identifiers.

Remove/disable unnecessary collection.

---

# 43. LOCAL DATA PRINCIPLE

Vhostra should save locally only what is genuinely required for functionality, including user-selected:

- settings;
- Sites;
- configuration;
- database/runtime state;
- backups;
- logs;
- preview screenshots;
- necessary operational metadata.

Do not collect unrelated personal information.

Do not transmit project paths, Hosts content, database information or Site content externally.

---

# 44. PRIVACY DOCUMENTATION

Ensure Help/About/Privacy accurately explains local data behavior.

Do not make absolute claims that are technically false.

For example, if Vhostra has an update checker, explain the limited network request accurately rather than claiming Vhostra never makes any network requests.

---

# 45. LIGHTWEIGHT REQUIREMENT

All these features must remain lightweight.

Preserve `PERFORMANCE.md` improvements.

Specifically:

- no continuous backup scanning;
- no continuous Hosts scanning;
- no continuous database hashing;
- no hidden-window polling;
- no tray polling loops;
- no unnecessary React re-renders;
- no unbounded undo history;
- no unbounded Hosts backups;
- no unbounded import logs;
- no unnecessary Docker rebuilds;
- Redis/Memcached off means no daemon;
- Resources visible-only polling;
- no external screenshot service.

---

# 46. HOSTS EDITOR MEMORY

Bound Undo/Redo history sensibly.

`/etc/hosts` is normally small, but do not create an unbounded editor-history implementation.

Clear editor history when the editor closes.

---

# 47. BACKUP COMPARISON PERFORMANCE

Use manifests/fingerprints/checksums generated at backup time where appropriate.

Do not repeatedly traverse and hash gigabytes of database/Site content merely to render onboarding.

Perform expensive comparison only when genuinely needed.

---

# 48. TRAY PERFORMANCE

Tray menu updates should be event-driven from:

- window shown;
- hidden;
- minimized;
- restored;
- quit state.

Do not poll window visibility every second.

---

# 49. TEXT SELECTION PERFORMANCE

Implement text-selection behavior through CSS/component semantics.

Do not add document-wide JavaScript selection listeners.

---

# 50. COMPLETE PREVIOUS WORK TOO

This prompt is additive.

Do not abandon incomplete requirements from previous phases, including:

- independent persistent MariaDB architecture;
- `DB_HOST=localhost`;
- MariaDB host-backed data/config;
- database users/roles/grants persistence;
- SQL import success/error alerts;
- reset semantics;
- CLI;
- Services;
- Resources;
- Site/vhost host-side persistence;
- manual Hosts editing;
- dashboard preview screenshots;
- explicit Quit behavior;
- privacy;
- server/PHP configuration persistence.

Read the persistent audit/checklist/cursor and continue unresolved items.

---

# 51. TEST ACTUAL USER FLOWS

Do not declare completion merely because unit tests pass.

Validate:

## Redis

PHP application connects to:

`localhost`

## Memcached

PHP application connects to:

`localhost`

## Tray

- show app
- minimize
- minimize to tray
- restore
- hide
- explicit Quit

Tray icon must not disappear incorrectly.

## Hosts

- type
- Undo
- Redo
- Restore Original
- Review Changes
- Cancel
- Save with elevation architecture
- Restore Previous Hosts File
- external modification race

## Backup

- new Site
- identical Site
- changed Site
- new database
- identical database where identity can be proven
- conflicting database
- DB user conflict
- role/grant conflict
- skip
- replace
- cancelled conflict
- different selected web server
- generated native config

---

# 52. PLATFORM TESTING

Implement platform-independent behavior completely.

Actual protected OS prompts on macOS/Windows/Linux may remain documented native acceptance tests where those OS environments are unavailable.

Do not use lack of Windows/Linux machines as an excuse to leave the implementation path missing.

---

# 53. HEAVY TESTS SEQUENTIALLY

Do not run multiple heavy Docker integration suites concurrently.

This Mac previously became unresponsive.

Run heavy runtime tests sequentially.

Never touch unrelated Docker projects such as SpeedClarity.

---

# 54. UPDATE PERSISTENT DOCUMENTS

Update as appropriate:

- `VHOSTRA_COMPLETION_CHECKLIST.md`
- `VHOSTRA_FUNCTIONAL_AUDIT.md`
- `VHOSTRA_EXECUTION_STATE.md`
- `PERFORMANCE.md`

Reopen inaccurate completed items.

Keep `Next exact action` concrete.

Do not make a Git commit.

---

# FINAL VALIDATION

Before declaring locally implementable work complete, verify:

- Redis localhost;
- Memcached localhost;
- cache persistence across server/PHP changes;
- tray icon persistence;
- dynamic Open Vhostra menu;
- unnecessary Electron menus removed appropriately;
- text selection policy;
- Hosts Undo;
- Hosts Redo;
- Restore Original;
- Restore Previous Hosts File;
- scoped Hosts elevation;
- backup manifest;
- new/identical/conflict classification;
- no duplicate Site import;
- no duplicate DB import;
- DB users/roles/grants reconciliation;
- conflict confirmation;
- cross-server canonical restore;
- generated native config;
- privacy;
- lightweight idle behavior;
- all still-unresolved previous requirements;
- production build;
- automated tests;
- sequential live tests;
- DESIGN.md compliance and spacing.

# START NOW

Audit the current implementation and persistent completion documents.

Fix the disappearing tray icon first because it is an active regression.

Then implement Redis/Memcached localhost compatibility, Hosts editor history/recovery, backup reconciliation, and continue through all remaining locally implementable requirements.