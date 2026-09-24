#!/bin/sh
set -eu

LSPHP_BIN="/usr/local/lsws/lsphp${VHOSTRA_LSPHP_VERSION:?}/bin/lsphp"
test -x "$LSPHP_BIN" || { echo "Vhostra build error: requested LSPHP runtime is unavailable" >&2; exit 64; }

# The stock OLS config dispatches `fcgi-bin/lsphp` through the `lsphp8` link.
# Updating text references alone leaves that link pointing at the base image's
# bundled runtime, so replace it atomically before OpenLiteSpeed starts.
ln -sfn "$LSPHP_BIN" /usr/local/lsws/fcgi-bin/lsphp8

mkdir -p /var/log/vhostra /var/lib/mysql
# This is a Vhostra-managed built-in document root. OLS deliberately rejects
# symlinks which leave its vhost root, so seed the immutable bundled source on
# first use instead of exposing it through a cross-root link. It remains in the
# same supervised runtime and survives container replacement on the host.
if [ -L /var/www/html/phpmyadmin ]; then rm /var/www/html/phpmyadmin; fi
if [ ! -f /var/www/html/phpmyadmin/index.php ]; then cp -a /usr/share/phpmyadmin /var/www/html/phpmyadmin; fi
if [ ! -d /var/lib/mysql/mysql ]; then
  mariadb-install-db --user=mysql --datadir=/var/lib/mysql
fi
chown -R mysql:mysql /var/lib/mysql
if [ "${VHOSTRA_REDIS:-false}" = true ]; then redis-server /etc/redis/redis.conf --daemonize yes; fi
if [ "${VHOSTRA_MEMCACHED:-false}" = true ]; then memcached -u root -d; fi

exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
