#!/bin/sh
set -eu
case "${VHOSTRA_WEB_SERVER:-openlitespeed}" in
  openlitespeed) exec /usr/local/lsws/bin/openlitespeed -n ;;
  apache)
    printf 'Listen 8088\n' > /etc/apache2/ports.conf
    if [ "${VHOSTRA_HTTPS:-false}" = true ]; then printf 'Listen 8443\n' >> /etc/apache2/ports.conf; fi
    # Event MPM keeps only two processes and a small spare thread pool.
    printf '<IfModule mpm_event_module>\nStartServers 1\nMinSpareThreads 5\nMaxSpareThreads 10\nThreadsPerChild 10\nMaxRequestWorkers 40\nServerLimit 4\n</IfModule>\n' > /etc/apache2/mods-enabled/mpm_event.conf
    cp /etc/vhostra/apache/vhostra.conf /etc/apache2/sites-enabled/vhostra.conf
    mkdir -p /var/log/apache2
    exec /usr/sbin/apachectl -DFOREGROUND
    ;;
  nginx)
    sed -i "s/worker_processes auto;/worker_processes 1;/" /etc/nginx/nginx.conf
    rm -f /etc/nginx/sites-enabled/default
    cp /etc/vhostra/nginx/default.conf /etc/nginx/conf.d/vhostra.conf
    mkdir -p /var/log/nginx
    exec /usr/sbin/nginx -g 'daemon off;'
    ;;
  *) echo 'Unsupported Vhostra web server' >&2; exit 64 ;;
esac
