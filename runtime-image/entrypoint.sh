#!/bin/sh
set -eu

LSPHP_BIN="/usr/local/lsws/lsphp${VHOSTRA_LSPHP_VERSION:?}/bin/lsphp"
test -x "$LSPHP_BIN" || { echo "Vhostra build error: requested LSPHP runtime is unavailable" >&2; exit 64; }

mkdir -p /var/log/vhostra /var/lib/mysql
if [ "${VHOSTRA_REDIS:-false}" = true ]; then redis-server /etc/redis/redis.conf --daemonize yes; fi
if [ "${VHOSTRA_MEMCACHED:-false}" = true ]; then memcached -u root -d; fi

exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
