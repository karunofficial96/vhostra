#!/bin/sh
set -eu
case "${VHOSTRA_WEB_SERVER:-openlitespeed}" in
  openlitespeed) exec /usr/local/lsws/bin/openlitespeed -n ;;
  apache)
    printf 'Listen 8088\n' > /etc/apache2/ports.conf
    cp /etc/vhostra/apache/vhostra.conf /etc/apache2/sites-enabled/vhostra.conf
    mkdir -p /var/log/apache2
    exec /usr/sbin/apachectl -DFOREGROUND
    ;;
  nginx)
    rm -f /etc/nginx/sites-enabled/default
    cp /etc/vhostra/nginx/default.conf /etc/nginx/conf.d/vhostra.conf
    mkdir -p /var/log/nginx
    exec /usr/sbin/nginx -g 'daemon off;'
    ;;
  *) echo 'Unsupported Vhostra web server' >&2; exit 64 ;;
esac
