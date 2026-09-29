# VHOSTRA — ROUTING/SCREENSHOTS, STRICT TEXT SELECTION, DATABASE DUPLICATES AND THIRD-PARTY NOTICES

Continue the EXISTING Vhostra repository.

This is intentionally a NEW Codex chat.

DO NOT START OVER.

DO NOT:
- reset/revert existing working changes;
- discard completed functionality;
- delete user data;
- touch unrelated Docker projects;
- globally prune Docker;
- make a Git commit unless explicitly requested.

Everything must follow `DESIGN.md`, especially spacing, controls, alerts, expandable details, typography, themes and responsive behavior.

Preserve all previous privacy and performance improvements.

Before coding inspect:

- git status
- DESIGN.md
- VHOSTRA_COMPLETION_CHECKLIST.md
- VHOSTRA_FUNCTIONAL_AUDIT.md
- VHOSTRA_EXECUTION_STATE.md
- PERFORMANCE.md
- current screenshot/preview implementation
- canonical Site URL resolver
- Hosts/routing implementation
- database creation/user implementation
- global text-selection CSS/components
- package.json/package-lock.json
- Dockerfiles/runtime images
- bundled assets/fonts/icons

Add the requirements below to the persistent completion queue.

==================================================
1. ACTIVE SCREENSHOT REGRESSION
==================================================

Dashboard previews currently fail with:

`The Site could not be reached or its routing could not be verified.`

This happens for BOTH:

- localhost;
- named vhosts.

The previous problem attempted:

`http://127.0.0.1/`

That was incorrect for named vhosts.

Do NOT simply replace one fallback error with another.

Find the actual root cause.

==================================================
2. TEST LOCALHOST AND NAMED VHOSTS SEPARATELY
==================================================

These are different routing cases.

Test at minimum:

A. Vhostra localhost/default Site

B. Named Site:
`example.test`

C. Named Site with alias:
`www.example.test`

D. HTTP

E. HTTPS where enabled

F. custom HTTP/HTTPS ports where supported

Determine exactly why routing verification rejects them.

==================================================
3. LOCALHOST PREVIEW
==================================================

For the Vhostra localhost/default page, use the real URL Vhostra exposes.

Do not assume:

`http://127.0.0.1/`

if that is not the actual working Vhostra URL/port.

Resolve protocol + host + port from real runtime configuration.

If localhost is actually served as:

`http://localhost[:port]/`

use that.

Verify it really loads before screenshot capture.

==================================================
4. NAMED VHOST PREVIEW
==================================================

For a named Site, navigate using its actual hostname.

Example:

Server Name:
`example.test`

Alias:
`www.example.test`

Prefer the configured canonical Server Name when valid.

Use alias only when appropriate.

Do NOT navigate to bare 127.0.0.1 for a named vhost.

==================================================
5. DO NOT OVER-STRICTLY "VERIFY" ROUTING
==================================================

Audit the current routing verification.

It may be rejecting a Site that actually loads correctly.

Do not require arbitrary page content, title, DOM marker or response signature that ordinary imported Sites do not contain.

Routing verification should prove enough to avoid capturing Vhostra's wrong/default vhost without requiring the user's Site to contain Vhostra-specific markup.

==================================================
6. VERIFY CORRECT VHOST USING SERVER KNOWLEDGE
==================================================

Use information Vhostra already owns:

- Site ID;
- canonical Server Name;
- aliases;
- Hosts state;
- generated native vhost configuration;
- selected web server;
- HTTP/HTTPS ports;
- runtime health.

Do not rely only on HTTP status.

Do not require modifying the user's Site.

Where necessary, devise a lightweight internal routing verification method based on Vhostra's server configuration rather than Site content.

==================================================
7. DEBUG ROUTING LAYERS
==================================================

Trace separately:

Site canonical config
→ generated native config
→ Hosts mapping
→ DNS/hostname resolution
→ protocol
→ port
→ web-server vhost match
→ HTTP response
→ Electron navigation
→ screenshot.

Report which layer is actually failing.

Do not guess.

==================================================
8. ELECTRON LOCAL HOSTNAME RESOLUTION
==================================================

Verify the hidden screenshot BrowserWindow/webContents can resolve Vhostra's local custom domains.

Do not assume that because the user's external browser can open:

`example.test`

Electron necessarily follows the same path.

Investigate actual Electron navigation behavior.

==================================================
9. NO REMOTE SCREENSHOT SERVICE
==================================================

All screenshots must be generated locally.

Never transmit:

- Site hostname;
- Site URL;
- Site contents;
- screenshot;
- Site files

to an external screenshot service.

==================================================
10. SCREENSHOT VIEWPORT
==================================================

Capture only the first useful desktop viewport.

Do NOT capture a full-page screenshot.

The screenshot must contain:

- no visible vertical scrollbar;
- no visible horizontal scrollbar.

Do not modify Site files/CSS permanently.

Use temporary screenshot-context-only scrollbar suppression.

==================================================
11. SCREENSHOT PERFORMANCE
==================================================

Screenshots must remain event-driven/on-demand.

No continuous screenshot polling.

No permanent hidden Chromium renderer solely for screenshots.

Capture sequentially.

Destroy/release temporary capture resources.

Cache previews locally.

==================================================
12. SCREENSHOT FAILURE UX
==================================================

If capture genuinely fails, show simple language.

Example:

**Preview could not be generated.**

Then a short actual reason.

Allow expandable technical details when useful.

Do not make:

`The Site could not be reached or its routing could not be verified.`

a generic catch-all for every failure.

==================================================
13. REFRESH PREVIEW
==================================================

Ensure an individual Site has an appropriate Refresh Preview action.

Refreshing one Site must not regenerate every Site screenshot.

==================================================
14. STRICT TEXT-SELECTION RULE
==================================================

The current implementation is STILL WRONG.

Implement the following rule literally:

DEFAULT:

ALL VHOSTRA UI TEXT IS UNSELECTABLE.

Only explicit value/content components listed below may opt into selection.

Do not attempt to identify selectable content using broad selectors that accidentally include labels.

==================================================
15. EXACTLY WHAT MAY BE SELECTABLE
==================================================

Selectable:

1. status VALUE of each service/runtime;
2. server name VALUE;
3. server alias VALUE;
4. folder location/path VALUE;
5. file location/path VALUE;
6. Error Messages;
7. Success Messages;
8. Values deliberately shown to the user;
9. Cause of Error;
10. runtime terminal/process output where previously required;
11. editable inputs/textareas/editors;
12. Hosts editor;
13. log/error diagnostic content where it qualifies above.

Everything else must be unselectable.

==================================================
16. SERVICE EXAMPLE
==================================================

If Dashboard displays:

OpenLiteSpeed     Running

then:

`OpenLiteSpeed`
MUST NOT be selectable.

`Running`
MUST be selectable.

The current behavior reportedly selects the service name instead of its status.

FIX IT.

==================================================
17. SERVER EXAMPLE
==================================================

If:

Server Name
example.test

then:

`Server Name`
unselectable.

`example.test`
selectable.

If:

Server Alias
www.example.test

then:

`Server Alias`
unselectable.

`www.example.test`
selectable.

==================================================
18. PATH EXAMPLE
==================================================

If:

Document Root
/Users/example/Sites/example

then:

`Document Root`
unselectable.

`/Users/example/Sites/example`
selectable.

==================================================
19. ERROR EXAMPLE
==================================================

Heading/label:

`Cause of Error`

may be treated according to the requested Cause-of-Error selectable content, but ordinary surrounding UI labels remain unselectable.

The actual cause/value must definitely be selectable.

Error and success messages must be selectable.

==================================================
20. IMPLEMENT SELECTION SEMANTICALLY
==================================================

Prefer:

global/default `user-select: none`

plus explicit reusable classes/components such as conceptually:

- selectable-value
- selectable-status
- selectable-path
- selectable-message
- selectable-diagnostic

Do not use fragile DOM-position selectors.

Do not use JavaScript selection event handlers.

==================================================
21. INPUTS MUST STILL WORK
==================================================

Never break:

- cursor;
- typing;
- selection;
- copy;
- paste;
- undo;
- redo

inside actual editable controls.

==================================================
22. AUDIT THE ENTIRE APPLICATION
==================================================

Check:

- Dashboard;
- Sites;
- Services;
- Resources;
- Databases;
- Logs;
- Settings;
- onboarding;
- dialogs;
- Hosts editor;
- errors;
- progress;
- runtime terminal.

Do not fix only Dashboard.

==================================================
23. CUSTOM DATABASE USER DUPLICATE BUG
==================================================

When creating a database and the user selects:

`Custom…`

Vhostra must validate the requested database account BEFORE creating the database.

Account identity is:

`User@Host`

not username alone.

==================================================
24. DEFAULT CUSTOM HOST
==================================================

Custom user fields:

Username
Password
Host

Host default:

`localhost`

Preserve the previously required real MariaDB/Docker localhost compatibility work.

Do not assume localhost account semantics without validating the actual connection path.

==================================================
25. PRE-CREATION VALIDATION ORDER
==================================================

When the user clicks Create Database with a Custom user:

1. validate database name;
2. validate username;
3. validate Host;
4. check whether exact requested `User@Host` already exists;
5. check other required conflicts/validity;
6. ONLY if validation succeeds proceed with creation.

Do not create the database first and discover the duplicate user afterward.

==================================================
26. EXISTING CUSTOM USER — REQUIRED BEHAVIOR
==================================================

If the requested exact `User@Host` already exists:

DO NOT:

- create the database;
- execute CREATE USER;
- clear the form;
- clear Database Name;
- show raw ERROR 1396 as the primary message.

Stop before mutation.

==================================================
27. DUPLICATE USER ERROR MESSAGE
==================================================

Show a simple DESIGN.md error such as:

**Database user already exists.**

`"karu_dbuser" already exists for host "localhost". Select this user from the Database User list instead.`

Use the actual safe username/host values.

Do not expose password information.

==================================================
28. PRESERVE DATABASE NAME
==================================================

This is important.

When duplicate Custom user validation fails:

KEEP the current:

Database Name

text-box value exactly as the user entered it.

Also preserve other safe form values where appropriate.

Do not make the user type the database name again.

==================================================
29. HELP USER RECOVER
==================================================

After the duplicate error, make it easy to select the existing account.

At minimum:

- keep the Database Name;
- refresh/ensure the existing account appears in Database User dropdown;
- instruct user to select it.

If DESIGN.md and existing component architecture make it clean, an action such as:

**Select Existing User**

may automatically change the dropdown to that exact `User@Host`.

Do not automatically change it without a clear user action.

==================================================
30. DATABASE USER DROPDOWN
==================================================

List appropriate existing application users.

Display enough identity to distinguish accounts:

`karu_dbuser @ localhost`

versus:

`karu_dbuser @ %`

Do not expose internal/system accounts unnecessarily.

==================================================
31. EXISTING USER WORKFLOW
==================================================

When the user selects an existing user:

do NOT CREATE USER.

Create the database only after all validation succeeds.

Then grant the requested appropriate access to that database while preserving unrelated grants.

Validate connectivity.

==================================================
32. DATABASE CREATION TRANSACTION SAFETY
==================================================

Avoid partial state.

If database creation succeeds but a later grant operation fails, do not silently leave confusing partial state.

Use an appropriate rollback/recovery strategy where safe.

At minimum report exactly what succeeded and failed.

==================================================
33. DATABASE LIST REFRESH
==================================================

Preserve/fix the previous requirement:

after successful database creation, the new database must immediately appear in the UI.

Use real MariaDB as source of truth.

Event-driven refresh after mutation.

No continuous polling.

==================================================
34. SIMPLE ERROR LANGUAGE
==================================================

All Vhostra errors must have a simple primary message.

Examples:

**Database user already exists.**

**Database could not be created.**

**The website could not connect to MariaDB.**

**Preview could not be generated.**

Then explain the actual problem simply.

==================================================
35. EXPANDABLE TECHNICAL DETAILS
==================================================

Where useful:

**Show details**

may expose selectable, sanitized:

- Cause;
- affected value;
- service;
- file;
- line;
- technical message.

Do not fabricate information.

Never expose secrets.

==================================================
36. SUCCESS LANGUAGE
==================================================

Use simple messages such as:

**Database created successfully.**

**Database imported successfully.**

**Database user created successfully.**

**Preview updated successfully.**

Follow DESIGN.md alert behavior.

==================================================
37. PRIVACY — STRICT REQUIREMENT
==================================================

Perform another privacy audit.

Vhostra must NOT remotely collect or transmit personal/sensitive user data.

No:

- analytics;
- telemetry;
- advertising tracking;
- remote logs;
- external screenshot APIs;
- Site-name collection;
- Site-path collection;
- database-name collection;
- database-user collection;
- database-password collection;
- database-content upload;
- Hosts-file upload;
- Site-content upload;
- screenshot upload;
- unique tracking identifiers.

==================================================
38. SAVE ONLY NECESSARY LOCAL DATA
==================================================

Persist locally only what Vhostra genuinely needs for functionality and the settings/configuration selected by the user.

Secrets require appropriate secure local handling.

Do not store secrets in logs or diagnostics.

==================================================
39. LIGHTWEIGHT — STRICT REQUIREMENT
==================================================

CPU, RAM and storage usage must remain VERY LOW.

Preserve `PERFORMANCE.md` improvements.

Do not add:

- screenshot polling;
- database polling;
- selection JavaScript listeners;
- continuous routing probes;
- continuous Hosts scans;
- unbounded caches;
- unbounded logs;
- leaked BrowserWindows;
- duplicate Electron instances.

==================================================
40. ROUTING CHECKS MUST BE ON DEMAND
==================================================

Do routing verification:

- when preview is needed;
- when Site URL/config changes;
- on explicit Refresh Preview.

Do not continuously probe every vhost.

==================================================
41. THIRD_PARTY_NOTICES.md
==================================================

I have NOT yet run the previous THIRD_PARTY_NOTICES.md task.

Do it in this phase.

Create:

`THIRD_PARTY_NOTICES.md`

in the repository root.

Do NOT create a Vhostra LICENSE file.

I currently do not want to select a license for Vhostra itself.

==================================================
42. THIRD-PARTY AUDIT
==================================================

Inspect the actual project.

At minimum audit:

- package.json;
- package-lock.json;
- production npm dependencies;
- Electron;
- React;
- Vite/build dependencies where relevant;
- Dockerfiles/base images;
- MariaDB image/base;
- OpenLiteSpeed/LiteSpeed components;
- Apache;
- Nginx;
- PHP/LSPHP;
- Redis;
- Memcached;
- phpMyAdmin;
- cwebp/WebP tools;
- bundled fonts;
- bundled icons/icon libraries;
- images/assets;
- DESIGN.md;
- copied/adapted third-party code;
- other distributed third-party material.

==================================================
43. DESIGNMD REFERENCE
==================================================

The Vhostra UI/design was developed with reference to:

`https://designmd.ai/chef/red-broadcast`

Inspect repository evidence for what was actually:

- referenced;
- copied;
- generated;
- adapted;
- bundled.

Do NOT invent DesignMD licensing terms.

If the applicable terms cannot be verified from repository material or an authoritative source available to the environment, put it under:

**Items Requiring License Verification**

==================================================
44. ICONS
==================================================

Identify the actual icon library/assets used.

If icons are from a third-party library, identify the verified license and attribution requirements.

Do not assume that because icons are easy to copy they are copyright-free.

==================================================
45. FONTS
==================================================

Audit locally bundled fonts.

Identify their verified licenses and any redistribution requirements.

Do not redistribute font license rights that Vhostra does not possess.

==================================================
46. THIRD_PARTY_NOTICES STRUCTURE
==================================================

Use a useful structure such as:

# Third-Party Notices

Vhostra includes or uses third-party software and assets. Those components remain subject to their respective licenses and copyright terms.

## Runtime / Application Components

## Docker / Server Components

## Fonts

## Icons and Visual Assets

## Design References / Assets

## Development Dependencies

## Items Requiring License Verification

Adjust categories to match the actual repository.

==================================================
47. DO NOT INVENT LEGAL INFORMATION
==================================================

For each relevant component record verified information such as:

- component/asset name;
- verified copyright holder/author where available;
- license;
- source/project;
- required notice/attribution where applicable;
- whether shipped/runtime or development-only.

Do NOT invent:

- licenses;
- copyright holders;
- authors;
- URLs;
- obligations.

==================================================
48. LICENSE TEXTS
==================================================

Audit whether third-party licenses require:

- complete license text;
- copyright notice;
- attribution;
- NOTICE;
- source availability;
- modification notice;
- redistribution conditions.

If complete license texts should accompany Vhostra, use an appropriate structure such as:

`third-party-licenses/`

but only where actually appropriate.

Do not copy license text from memory.

Use verified license material.

==================================================
49. NO VHOSTRA LICENSE
==================================================

Do NOT add:

`LICENSE`

for Vhostra.

Do NOT label Vhostra as MIT/GPL/Apache/open source.

The source may be visible, but I have not selected a Vhostra software license.

Third-party licenses remain their own licenses.

==================================================
50. THIRD-PARTY REPORT
==================================================

At completion report:

1. whether THIRD_PARTY_NOTICES.md was created;
2. major third-party components identified;
3. obligations needing attention;
4. licenses/terms that could not be verified;
5. anything requiring action before public distribution;
6. whether additional third-party license files were needed.

Do not provide unsupported legal conclusions.

==================================================
51. COMPLETE PREVIOUSLY UNRESOLVED REQUIREMENTS
==================================================

This prompt is additive.

After fixing these active regressions, continue any locally implementable requirements still genuinely incomplete in:

- VHOSTRA_COMPLETION_CHECKLIST.md
- VHOSTRA_FUNCTIONAL_AUDIT.md
- VHOSTRA_EXECUTION_STATE.md

Do not mark something complete simply because an old checkbox says [x].

==================================================
52. TEST SCREENSHOTS
==================================================

Actually validate:

A. localhost preview

B. example.test preview

C. alias fallback

D. named vhost is not replaced by localhost/default content

E. HTTP

F. HTTPS where available

G. custom port

H. both scrollbars absent

I. Refresh Preview

J. capture resources released

K. no remote screenshot request

==================================================
53. TEST TEXT SELECTION
==================================================

Explicitly verify:

Service name:
UNSELECTABLE

Service status:
SELECTABLE

"Server Name" label:
UNSELECTABLE

Server Name value:
SELECTABLE

"Server Alias" label:
UNSELECTABLE

Alias value:
SELECTABLE

Path label:
UNSELECTABLE

Path value:
SELECTABLE

ordinary Dashboard text:
UNSELECTABLE

button text:
UNSELECTABLE

error:
SELECTABLE

success:
SELECTABLE

Cause/value:
SELECTABLE

Do this across all major screens.

==================================================
54. TEST DATABASE DUPLICATE FLOW
==================================================

Create/ensure:

`karu_dbuser@localhost`

exists in an isolated Vhostra-owned test environment.

Enter a NEW database name.

Select:

Custom…

Enter:

Username:
`karu_dbuser`

Host:
`localhost`

Expected:

- Vhostra detects existing account BEFORE mutation;
- database is NOT created;
- CREATE USER is NOT executed;
- simple duplicate error shown;
- Database Name remains in text box;
- existing account is available in dropdown;
- no ERROR 1396 as normal UI behavior.

Then select the existing account and retry.

Expected:

- database created;
- existing user reused;
- correct grants applied;
- database immediately appears in UI.

==================================================
55. HEAVY TESTS SEQUENTIALLY
==================================================

Run heavy Docker/Electron tests sequentially.

This Mac has previously become unresponsive.

Do not run several heavy runtime suites concurrently.

Never touch unrelated Docker projects such as SpeedClarity.

==================================================
56. UPDATE PERSISTENT DOCUMENTS
==================================================

Update:

- VHOSTRA_COMPLETION_CHECKLIST.md
- VHOSTRA_FUNCTIONAL_AUDIT.md
- VHOSTRA_EXECUTION_STATE.md
- PERFORMANCE.md where relevant

Reopen inaccurate completed requirements.

Keep a concrete Next exact action.

Do not make a Git commit.

==================================================
EXECUTION ORDER
==================================================

1. Reproduce localhost screenshot failure.
2. Reproduce named-vhost screenshot failure.
3. Trace canonical URL/routing verification and fix root cause.
4. Validate screenshots and scrollbar behavior.
5. Fix strict text-selection semantics globally.
6. Fix Custom database-user preflight/duplicate workflow.
7. Verify database list refresh.
8. Audit simple errors/diagnostics.
9. Create/audit THIRD_PARTY_NOTICES.md.
10. Run privacy audit.
11. Run performance/leak audit.
12. Continue genuinely unresolved previous requirements.

==================================================
COMPLETION RULE
==================================================

Do NOT report screenshots fixed unless BOTH:

- localhost;
- named vhosts

actually generate the correct preview.

Do NOT report text selection fixed unless service names are unselectable while their status VALUES are selectable.

Do NOT report duplicate-user handling fixed unless the database remains uncreated and Database Name remains populated when Custom selects an already-existing exact User@Host.

Do NOT report third-party notices complete if uncertain licenses were guessed instead of clearly marked for verification.

Do not make a Git commit.

START NOW.