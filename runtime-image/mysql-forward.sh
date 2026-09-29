#!/bin/sh
set -eu
mkdir -p /run/mysqld
chmod 0755 /run/mysqld
# No database readiness loop here: each connection resolves the stable alias.
# A stopped/starting database fails a connection without restarting web/PHP.
exec socat "$1" TCP4:vhostra-mariadb:3306,connect-timeout=5
