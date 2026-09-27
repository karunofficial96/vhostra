#!/bin/sh
set -eu
version="${VHOSTRA_LSPHP_VERSION:?}"
minor="${version%?}.${version#?}"
# Same selected LiteSpeed PHP package/extension ABI; no second PHP installation.
# Only Apache/Nginx need this loopback development backend. OLS uses LSAPI.
export PHP_INI_SCAN_DIR="/usr/local/lsws/lsphp${version}/etc/php/${minor}/mods-available"
export PHP_CLI_SERVER_WORKERS=2
exec "/usr/local/lsws/lsphp${version}/bin/php" \
  -c "/usr/local/lsws/lsphp${version}/etc/php/${minor}/litespeed/php.ini" \
  -d opcache.enable_cli=1 -S 127.0.0.1:8089 -t /var/www/html /usr/local/share/vhostra/php-router.php
