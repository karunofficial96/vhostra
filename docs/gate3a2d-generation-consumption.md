# Gate 3A.2d synthetic generation consumption — 2026-10-07

The production machine Store and runtime guards remain closed. The staging
file store and physical cleanup module are test primitives, not production
coordinator backends. No machine activation or protected mutation was run.

## Selection and container content

Machine Compose accepts a resolver-issued `CommittedBuiltInGeneration` token.
The resolver reads the one strict ledger, selects its committed ID, validates
the fixed managed path, rejects links and excess/unmanifested files, and
checks all content hashes. Compose cannot accept a caller path or choose a
directory by name. The token is a validated snapshot; a future signed
coordinator must serialize resolution, commit and Compose acceptance under
one protected generation transaction so an old token cannot be used after a
later commit. No such production acceptance path exists today.

The machine Compose mount is read-only at `/usr/share/vhostra/builtin`.
Entrypoint copies this Vhostra-only bundle into the disposable container
layer at `/var/www/html`. phpMyAdmin application code comes from the selected
image's `/usr/share/phpmyadmin` and is copied into that same container layer;
its PHP config reads the password from the delivered environment at runtime.
No second host phpMyAdmin tree or password file is published. User Site roots
remain separate exact bind mounts; publication and recreation do not write
them. The legacy runtime path is unchanged.

## Ledger durability and recovery

The synthetic `StagingGenerationFileStore` writes one 0600 ledger under a
fixed 0700 configuration directory. Each CAS holds an exclusive directory
lock, writes a new temporary file, syncs that file, renames it over the
ledger, and syncs the containing directory. A candidate is recorded as
preparing first. The publisher syncs each created directory and content file
and publishes its hash manifest last. A verified candidate can then replace
the committed pointer in one ledger record. The prior committed ID becomes a
rollback pointer and its content remains. An incomplete candidate never
becomes selected merely because its directory exists. A missing, truncated,
malformed, linked or tampered committed generation fails closed.

Crash-injection tests distinguish interruption before rename (old ledger)
from interruption after rename (new ledger visible to a fresh controller).
An actual crash after rename but before the directory sync may leave either
version on restart. The authoritative old-or-new choice is whichever complete
ledger the filesystem exposes. Node `fsync` plus rename does not establish a
power-loss guarantee on every macOS filesystem/device; Node does not expose
macOS `F_FULLFSYNC` here. The future signed service must choose and verify its
native durability primitive, filesystem, cross-process lock recovery and
privileged no-follow operations. A crash leaving `.write-lock` stops future
writes until trusted recovery, while reads can still recover the committed
generation. There is no polling, watcher or automatic stale-lock takeover.

The ledger transition API records `verified` as a semantic assertion by its
trusted coordinator. The synthetic tests publish and resolve complete content
before commit, but this standalone staging controller is not a substitute
for a production service that must bind content/configuration verification to
the commit transaction.

## Cleanup

Synthetic cleanup derives IDs only from the validated ledger and uses only
the fixed `service-data/localhost/generations` tree. It retains current,
rollback and incomplete entries, checks ancestor and child types, bounds
depth/count/bytes, rejects links and unknown files, and deletes only failed or
older retired managed generations. A vanished obsolete directory is
idempotent. Unlisted directories and Site/database/certificate trees are
left alone. This is single-writer synthetic cleanup: the future signed
service must defend against concurrent path replacement with native
descriptor-relative/no-follow deletion before using it on protected data.
