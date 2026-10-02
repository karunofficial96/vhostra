#!/bin/sh
set -eu
version="${VHOSTRA_LSPHP_VERSION:?}"
minor="${version%?}.${version#?}"
# Apache and Nginx speak FastCGI to this selected normal PHP-FPM package.
# OpenLiteSpeed runs matching LSPHP through LSAPI instead.
exec "/usr/sbin/php-fpm${minor}" --nodaemonize --fpm-config "/etc/php/${minor}/fpm/php-fpm.conf"
