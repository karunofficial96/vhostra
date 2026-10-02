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
cp /usr/local/lsws/conf/httpd_config.vhostra-base.conf /usr/local/lsws/conf/httpd_config.conf
cp /usr/local/share/vhostra/supervisor-base.conf /etc/supervisor/conf.d/vhostra.conf
# OLS creates sibling .conf0 backups while reloading/restarting. The generated
# host mount stays read-only and authoritative; only this disposable working
# copy can be modified by native OLS tooling. No document-root tree is copied.
mkdir -p /usr/local/lsws/conf/vhostra-sites
for source in /etc/vhostra/openlitespeed/sites/*.conf; do
  if [ -f "$source" ]; then cp "$source" /usr/local/lsws/conf/vhostra-sites/; fi
done

if [ -s /etc/vhostra/openlitespeed/vhostra-vhosts.conf ]; then
  sed -i '/^    secure[[:space:]]\+0/r /etc/vhostra/openlitespeed/vhostra-maps.conf' /usr/local/lsws/conf/httpd_config.conf
  cat /etc/vhostra/openlitespeed/vhostra-vhosts.conf >> /usr/local/lsws/conf/httpd_config.conf
fi

# The upstream Docker demo owns unused :80/:443 listeners and a second
# localhost vhost which eagerly starts another PHP process group. Vhostra's
# protected Example vhost (:8088) and native TLS listener remain authoritative.
awk '
  /^listener HTTP \{|^listener HTTPS \{|^vhTemplate docker \{/ { skip=1; depth=0 }
  skip { line=$0; depth+=gsub(/\{/, "{", line); line=$0; depth-=gsub(/\}/, "}", line); if(depth==0) skip=0; next }
  { print }
' /usr/local/lsws/conf/httpd_config.conf > /usr/local/lsws/conf/httpd_config.conf.new
mv /usr/local/lsws/conf/httpd_config.conf.new /usr/local/lsws/conf/httpd_config.conf

# Conservative local worker counts, rather than one OLS worker per VM CPU.
sed -Ei 's/PHP_LSAPI_CHILDREN=10/PHP_LSAPI_CHILDREN=4/; s/LSAPI_AVOID_FORK=200M/LSAPI_AVOID_FORK=0/; /^extProcessor lsphp\{/,/^\}/ s/maxConns[[:space:]]+10/maxConns 4/; s/logLevel[[:space:]]+DEBUG/logLevel INFO/; s/keepDays[[:space:]]+30/keepDays 7/; s/compressArchive[[:space:]]+0/compressArchive 1/' /usr/local/lsws/conf/httpd_config.conf
printf '\nhttpdWorkers 1\n' >> /usr/local/lsws/conf/httpd_config.conf
sed -i 's|errorlog logs/error.log|errorlog /var/log/vhostra/openlitespeed-error.log|; s|accessLog logs/access.log|accessLog /var/log/vhostra/openlitespeed-access.log|' /usr/local/lsws/conf/httpd_config.conf
sed -i '/errorlog \/var\/log\/vhostra\/openlitespeed-error.log {/a\        keepDays 7\n        compressArchive 1' /usr/local/lsws/conf/httpd_config.conf
sed -i '/PHP_LSAPI_CHILDREN=4/a\    env LSAPI_MAX_IDLE_CHILDREN=1\n    env LSAPI_MAX_IDLE=30' /usr/local/lsws/conf/httpd_config.conf

# Disabled services have no placeholder processes. Supervisor still exposes
# their stopped state for explicit service controls.
for service in redis memcached; do
  eval 'enabled=${VHOSTRA_'"$(printf '%s' "$service" | tr 'a-z' 'A-Z')"':-false}'
  if [ "$enabled" = true ]; then sed -i "/\[program:$service\]/,/^$/s/autostart=false/autostart=true/" /etc/supervisor/conf.d/vhostra.conf; fi
done
if [ "${VHOSTRA_WEB_SERVER:-openlitespeed}" != openlitespeed ]; then
  sed -i '/\[program:php-backend\]/,/^$/s/autostart=false/autostart=true/' /etc/supervisor/conf.d/vhostra.conf
  sed -i '/\[program:site-log-maintenance\]/,/^$/s/autostart=false/autostart=true/' /etc/supervisor/conf.d/vhostra.conf
fi

# Keep PHP's implementation details out of HTTP responses for every selected
# LSPHP package. The version selector is always two digits (81 through 85).
PHP_VERSION="${VHOSTRA_LSPHP_VERSION%?}.${VHOSTRA_LSPHP_VERSION#?}"
OPCACHE_ENABLED=1
[ "${VHOSTRA_OPCACHE:-true}" = true ] || OPCACHE_ENABLED=0
PHP_INI="/usr/local/lsws/lsphp${VHOSTRA_LSPHP_VERSION}/etc/php/${PHP_VERSION}/litespeed/php.ini"
sed -i '/; Vhostra PHP policy begin/,/; Vhostra PHP policy end/d' "$PHP_INI"
{
  printf '\n; Vhostra PHP policy begin\nexpose_php=Off\nopcache.enable=%s\nopcache.memory_consumption=64\nupload_max_filesize=64M\npost_max_size=65M\n' "$OPCACHE_ENABLED"
  cat /etc/vhostra/php/vhostra.ini
  printf '; Vhostra PHP policy end\n'
} >> "$PHP_INI"

# LiteSpeed scans mods-available directly, including separately packaged Zend
# modules. Remove legacy duplicate directives and toggle the package INI itself.
PHP_INI="/usr/local/lsws/lsphp${VHOSTRA_LSPHP_VERSION}/etc/php/${PHP_VERSION}/litespeed/php.ini"
sed -i '/; Vhostra OPcache module$/d' "$PHP_INI"
configure_extension() {
  extension="$1"; enabled="$2"
  dir="/usr/local/lsws/lsphp${VHOSTRA_LSPHP_VERSION}/etc/php/${PHP_VERSION}/mods-available"
  source="$(find "$dir" -maxdepth 1 -type f -name "*${extension}.ini" -print -quit)"
  disabled="$(find "$dir" -maxdepth 1 -type f -name "*${extension}.ini.disabled" -print -quit)"
  sed -i "/; Vhostra extension ${extension}$/d" "$PHP_INI"
  if [ "$enabled" = true ]; then
    if [ -n "$disabled" ]; then mv "$disabled" "${disabled%.disabled}";
    elif [ -z "$source" ]; then echo "Vhostra build error: selected LSPHP extension ${extension} is unavailable" >&2; exit 65; fi
  elif [ -n "$source" ]; then mv "$source" "$source.disabled";
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
  # Normal PHP-FPM keeps its own versioned SAPI module links. A module enabled
  # only for LSPHP must never appear active under Apache or Nginx.
  if [ "$enabled" = true ]; then
    phpenmod -v "$PHP_VERSION" -s fpm "$extension"
  else
    phpdismod -v "$PHP_VERSION" -s fpm "$extension"
  fi
done

FPM_INI="/etc/php/${PHP_VERSION}/fpm/php.ini"
sed -i '/; Vhostra PHP policy begin/,/; Vhostra PHP policy end/d' "$FPM_INI"
{
  printf '\n; Vhostra PHP policy begin\nexpose_php=Off\nopcache.enable=%s\nopcache.memory_consumption=64\nupload_max_filesize=64M\npost_max_size=65M\n' "$OPCACHE_ENABLED"
  cat /etc/vhostra/php/vhostra.ini
  printf '; Vhostra PHP policy end\n'
} >> "$FPM_INI"
rm -f "/etc/php/${PHP_VERSION}/fpm/pool.d/www.conf"
cat > "/etc/php/${PHP_VERSION}/fpm/pool.d/vhostra.conf" <<'FPM_POOL'
[vhostra]
user = nobody
group = nogroup
listen = 127.0.0.1:8089
listen.allowed_clients = 127.0.0.1
pm = ondemand
pm.max_children = 2
pm.process_idle_timeout = 30s
pm.max_requests = 500
clear_env = no
security.limit_extensions = .php
php_admin_flag[log_errors] = on
FPM_POOL

# The built-in vhost is the same one used by the mounted Vhostra localhost
# page. Keep WordPress-style `.htaccess` permalinks available by default.
cp /etc/vhostra/openlitespeed/localhost.conf /usr/local/lsws/conf/vhosts/Example/vhconf.conf
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

if [ "${VHOSTRA_HTTPS:-false}" = true ] && [ "${VHOSTRA_WEB_SERVER:-openlitespeed}" = openlitespeed ]; then
  cat >> /usr/local/lsws/conf/httpd_config.conf <<'TLS'
listener VhostraTLS {
  address *:8443
  secure 1
  keyFile /etc/vhostra/certificates/private/localhost.key
  certFile /etc/vhostra/certificates/public/localhost.pem
  map Example *
TLS
  cat /etc/vhostra/openlitespeed/vhostra-maps.conf >> /usr/local/lsws/conf/httpd_config.conf
  printf '}\n' >> /usr/local/lsws/conf/httpd_config.conf
fi

# Preserve the stock protected context's authentication policy while providing
# its empty managed directory for strict native configuration validation.
mkdir -p /var/log/vhostra /run/mysqld /var/www/html/protected
ln -sfn /run/mysqld/mysqld.sock /tmp/mysql.sock
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
# Validate generated native syntax before any managed web/database process starts.
/usr/local/bin/vhostra-web-server --validate
exec /usr/bin/supervisord -c /etc/supervisor/supervisord.conf
