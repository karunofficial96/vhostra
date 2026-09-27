#!/bin/sh
set -eu

LSPHP_BIN="/usr/local/lsws/lsphp${VHOSTRA_LSPHP_VERSION:?}/bin/lsphp"
test -x "$LSPHP_BIN" || { echo "Vhostra build error: requested LSPHP runtime is unavailable" >&2; exit 64; }

# The stock OLS config dispatches `fcgi-bin/lsphp` through the `lsphp8` link.
# Updating text references alone leaves that link pointing at the base image's
# bundled runtime, so replace it atomically before OpenLiteSpeed starts.
ln -sfn "$LSPHP_BIN" /usr/local/lsws/fcgi-bin/lsphp8

# Apply the generated, server-neutral Vhostra virtual hosts to the stock OLS
# configuration at container start. The pristine image config is restored first
# so a restart cannot accumulate duplicate listener mappings or vhost blocks.
if [ -s /etc/vhostra/openlitespeed/vhostra-vhosts.conf ]; then
  cp /usr/local/lsws/conf/httpd_config.vhostra-base.conf /usr/local/lsws/conf/httpd_config.conf
  sed -i '/^    secure[[:space:]]\+0/r /etc/vhostra/openlitespeed/vhostra-maps.conf' /usr/local/lsws/conf/httpd_config.conf
  cat /etc/vhostra/openlitespeed/vhostra-vhosts.conf >> /usr/local/lsws/conf/httpd_config.conf
fi

# The selected frontend owns the public listener; OLS supplies selected LSPHP
# over an internal HTTP listener for Apache/Nginx PHP requests.
if [ "${VHOSTRA_WEB_SERVER:-openlitespeed}" != openlitespeed ]; then
  sed -i 's/\*:8088/*:8089/g' /usr/local/lsws/conf/httpd_config.conf
fi

# Keep PHP's implementation details out of HTTP responses for every selected
# LSPHP package. The version selector is always two digits (81 through 85).
PHP_VERSION="${VHOSTRA_LSPHP_VERSION%?}.${VHOSTRA_LSPHP_VERSION#?}"
OPCACHE_ENABLED=1
[ "${VHOSTRA_OPCACHE:-true}" = true ] || OPCACHE_ENABLED=0
printf '\nexpose_php=Off\nopcache.enable=%s\n' "$OPCACHE_ENABLED" >> "/usr/local/lsws/lsphp${VHOSTRA_LSPHP_VERSION}/etc/php/${PHP_VERSION}/litespeed/php.ini"

# Packages are installed once in the selected disposable image. LiteSpeed scans
# its package-provided module files, so toggle only those exact files instead
# of loading an extension twice through a generic PHP mechanism.
configure_extension() {
  extension="$1"; enabled="$2"
  source="$(find "/usr/local/lsws/lsphp${VHOSTRA_LSPHP_VERSION}" -path "*/mods-available/*${extension}.ini" -type f -print -quit)"
  [ -n "$source" ] || { [ "$enabled" = true ] && { echo "Vhostra build error: selected LSPHP extension ${extension} is unavailable" >&2; exit 65; }; return 0; }
  ini="/usr/local/lsws/lsphp${VHOSTRA_LSPHP_VERSION}/etc/php/${PHP_VERSION}/litespeed/php.ini"
  sed -i "/; Vhostra extension ${extension}$/d" "$ini"
  if [ "$enabled" = true ]; then
    grep -E '^[[:space:]]*extension[[:space:]]*=' "$source" | head -n 1 | sed 's/[[:space:]]*$//' | sed "s/$/ ; Vhostra extension ${extension}/" >> "$ini"
  fi
}
# Apply the persisted selection to every optional package included by the image,
# not just the Redis/Memcached dependency extensions. Disabled selections are
# installed for portability but deliberately left unloaded.
extensions="${VHOSTRA_PHP_EXTENSIONS:-},${VHOSTRA_PHP_DISABLED_EXTENSIONS:-},redis,memcached"
for extension in $(printf '%s' "$extensions" | tr ',' '\n' | sort -u); do
  [ -n "$extension" ] || continue
  enabled=false
  case ",${VHOSTRA_PHP_EXTENSIONS:-}," in *",${extension},"*) enabled=true;; esac
  [ "$extension" = redis ] && [ "${VHOSTRA_REDIS:-false}" = true ] && enabled=true
  [ "$extension" = memcached ] && [ "${VHOSTRA_MEMCACHED:-false}" = true ] && enabled=true
  case ",${VHOSTRA_PHP_DISABLED_EXTENSIONS:-}," in *",${extension},"*) enabled=false;; esac
  configure_extension "$extension" "$enabled"
done

# The built-in vhost is the same one used by the mounted Vhostra localhost
# page. Keep WordPress-style `.htaccess` permalinks available by default.
sed -Ei '/^rewrite[[:space:]]*\{/,/^\}/ s/^[[:space:]]*enable[[:space:]]+0[[:space:]]*$/  enable 1\n  autoLoadHtaccess 1/' /usr/local/lsws/conf/vhosts/Example/vhconf.conf

if [ "${VHOSTRA_HTTPS:-false}" = true ]; then
  mkdir -p /etc/vhostra/certificates/public /etc/vhostra/certificates/private
  chmod 0700 /etc/vhostra/certificates/private
  names="${VHOSTRA_TLS_NAMES:?}"
  saved="$(cat /etc/vhostra/certificates/public/names.txt 2>/dev/null || true)"
  if [ "$saved" != "$names" ] || ! openssl x509 -checkend 86400 -noout -in /etc/vhostra/certificates/public/localhost.pem >/dev/null 2>&1; then
    umask 077
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 -subj /CN=localhost -addext "subjectAltName=$names" -keyout /etc/vhostra/certificates/private/localhost.key.new -out /etc/vhostra/certificates/public/localhost.pem.new
    mv /etc/vhostra/certificates/private/localhost.key.new /etc/vhostra/certificates/private/localhost.key
    mv /etc/vhostra/certificates/public/localhost.pem.new /etc/vhostra/certificates/public/localhost.pem
    printf '%s' "$names" > /etc/vhostra/certificates/public/names.txt
    umask 022
  fi
fi

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
# Public Vhostra-owned files must be readable by the selected frontend worker.
chmod -R a+rX /var/www/html
if [ ! -d /var/lib/mysql/mysql ]; then
  mariadb-install-db --user=mysql --datadir=/var/lib/mysql
fi
chown -R mysql:mysql /var/lib/mysql
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
