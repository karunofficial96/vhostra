#!/bin/bash
set -euo pipefail
mkdir -p /run/mysqld /var/log/vhostra
chown mysql:mysql /run/mysqld /var/log/vhostra
if [ ! -d /var/lib/mysql/mysql ]; then
  mariadb-install-db --skip-test-db --user=mysql --datadir=/var/lib/mysql >/dev/null
  mariadbd --user=mysql --skip-networking --socket=/run/mysqld/mysqld.sock &
  bootstrap=$!
  trap 'kill "$bootstrap" 2>/dev/null || true' EXIT
  for attempt in {1..60}; do
    if mariadb --protocol=socket -uroot -e 'SELECT 1' >/dev/null 2>&1; then break; fi
    sleep 1
  done
  # Random secret is backend-only. Root retains local OS authentication and
  # a strong password alternative; root is never available without a password
  # through the mysql-owned socket gateway.
  secret=$(cat /run/secrets/root-password)
  [[ "$secret" =~ ^[a-zA-Z0-9_-]+$ ]] || exit 65
  printf "ALTER USER 'root'@'localhost' IDENTIFIED VIA unix_socket OR mysql_native_password USING PASSWORD('%s');\n" "$secret" | mariadb --protocol=socket -uroot
  unset secret
  mariadb-admin --protocol=socket -uroot shutdown
  wait "$bootstrap"
  trap - EXIT
fi
# Existing data is used directly. Only a first initialization chowns the tree;
# the root ownership check also accommodates the historical runtime UID.
if [ ! -f /var/lib/mysql/.vhostra-ownership-v1 ]; then
  chown -R mysql:mysql /var/lib/mysql
  touch /var/lib/mysql/.vhostra-ownership-v1
  chown mysql:mysql /var/lib/mysql/.vhostra-ownership-v1
fi
mariadbd --user=mysql --skip-networking --socket=/run/mysqld/mysqld.sock &
database=$!
# TCP clients arrive over the private network and enter the server over its
# local socket. This preserves existing user@localhost authentication/grants.
socat TCP4-LISTEN:3306,bind=0.0.0.0,reuseaddr,fork,su=mysql UNIX-CONNECT:/run/mysqld/mysqld.sock &
gateway=$!
(while sleep 300; do logrotate -s /var/log/vhostra/mariadb-logrotate.state /etc/vhostra-logrotate.conf; done) &
rotation=$!
cleanup() { kill "$gateway" "$rotation" 2>/dev/null || true; mariadb-admin --protocol=socket -uroot shutdown >/dev/null 2>&1 || kill "$database" 2>/dev/null || true; wait "$database" 2>/dev/null || true; }
trap cleanup EXIT
trap 'exit 0' TERM INT
wait -n "$database" "$gateway" "$rotation"
exit 1
