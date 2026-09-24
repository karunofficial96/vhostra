#!/bin/sh
set -eu

LSPHP_BIN="/usr/local/lsws/lsphp${VHOSTRA_LSPHP_VERSION:?}/bin/lsphp"
test -x "$LSPHP_BIN" || { echo "Vhostra build error: requested LSPHP runtime is unavailable" >&2; exit 64; }

# The stock OLS config dispatches `fcgi-bin/lsphp` through the `lsphp8` link.
# Updating text references alone leaves that link pointing at the base image's
# bundled runtime, so replace it atomically before OpenLiteSpeed starts.
ln -sfn "$LSPHP_BIN" /usr/local/lsws/fcgi-bin/lsphp8

# Keep PHP's implementation details out of HTTP responses for every selected
# LSPHP package. The version selector is always two digits (81 through 85).
PHP_VERSION="${VHOSTRA_LSPHP_VERSION%?}.${VHOSTRA_LSPHP_VERSION#?}"
printf '\nexpose_php=Off\n' >> "/usr/local/lsws/lsphp${VHOSTRA_LSPHP_VERSION}/etc/php/${PHP_VERSION}/litespeed/php.ini"

# The built-in vhost is the same one used by the mounted Vhostra localhost
# page. Keep WordPress-style `.htaccess` permalinks available by default.
sed -Ei '/^rewrite[[:space:]]*\{/,/^\}/ s/^[[:space:]]*enable[[:space:]]+0[[:space:]]*$/  enable 1\n  autoLoadHtaccess 1/' /usr/local/lsws/conf/vhosts/Example/vhconf.conf

mkdir -p /var/log/vhostra /var/lib/mysql /var/www/html
# This is a Vhostra-managed built-in document root. OLS deliberately rejects
# symlinks which leave its vhost root, so seed the immutable bundled source on
# first use instead of exposing it through a cross-root link. It remains in the
# same supervised runtime and survives container replacement on the host.
if [ -L /var/www/html/phpmyadmin ]; then rm /var/www/html/phpmyadmin; fi
if [ ! -f /var/www/html/phpmyadmin/index.php ]; then cp -a /usr/share/phpmyadmin /var/www/html/phpmyadmin; fi
# Configuration is Vhostra-owned runtime state, not user content. Render the
# config-auth secret only into PHP source (never an HTTP response or a client
# script) and refresh it on every disposable-container start.
sed "s/__VHOSTRA_PMA_PASSWORD__/${VHOSTRA_PMA_PASSWORD:?}/g" /usr/share/phpmyadmin/config.inc.php > /var/www/html/phpmyadmin/config.inc.php
chmod 0644 /var/www/html/phpmyadmin/config.inc.php
if [ ! -d /var/lib/mysql/mysql ]; then
  mariadb-install-db --user=mysql --datadir=/var/lib/mysql
fi
chown -R mysql:mysql /var/lib/mysql
if [ "${VHOSTRA_REDIS:-false}" = true ]; then redis-server /etc/redis/redis.conf --daemonize yes; fi
if [ "${VHOSTRA_MEMCACHED:-false}" = true ]; then memcached -u root -d; fi

exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
