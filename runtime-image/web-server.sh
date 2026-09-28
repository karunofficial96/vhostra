#!/bin/sh
set -eu
case "${VHOSTRA_WEB_SERVER:-openlitespeed}" in
  openlitespeed)
    if [ "${1:-}" = --validate ]; then
      # OLS -t returns 1 for warning-only checks, and 2 for configuration errors.
      # Accept only timestamped WARN lines; startup failures must still fail.
      if output=$(/usr/local/lsws/bin/openlitespeed -t 2>&1); then
        printf '%s\n' "$output"; exit 0
      else
        status=$?; printf '%s\n' "$output"
        if [ "$status" -eq 1 ] && printf '%s\n' "$output" | awk 'NF { seen=1; if ($0 !~ /^[0-9-]+ [0-9:.]+ \[WARN\]/) bad=1 } END { exit !(seen && !bad) }'; then exit 0; fi
        exit "$status"
      fi
    fi
    exec /usr/local/lsws/bin/openlitespeed -n ;;

  apache)
    printf 'Listen 8088\n' > /etc/apache2/ports.conf
    if [ "${VHOSTRA_HTTPS:-false}" = true ]; then printf 'Listen 8443\n' >> /etc/apache2/ports.conf; fi
    # Event MPM keeps only two processes and a small spare thread pool.
    printf '<IfModule mpm_event_module>\nStartServers 1\nMinSpareThreads 5\nMaxSpareThreads 10\nThreadsPerChild 10\nMaxRequestWorkers 40\nServerLimit 4\n</IfModule>\n' > /etc/apache2/mods-enabled/mpm_event.conf
    cp /etc/vhostra/apache/vhostra.conf /etc/apache2/sites-enabled/vhostra.conf
    mkdir -p /var/log/apache2
    if [ "${1:-}" = --validate ]; then exec /usr/sbin/apachectl -t; fi
    exec /usr/sbin/apachectl -DFOREGROUND
    ;;
  nginx)
    sed -i "s/worker_processes auto;/worker_processes 1;/; s|/var/log/nginx/error.log|/var/log/vhostra/nginx-error.log|; s|/var/log/nginx/access.log|/var/log/vhostra/nginx-access.log|" /etc/nginx/nginx.conf
    rm -f /etc/nginx/sites-enabled/default
    cp /etc/vhostra/nginx/default.conf /etc/nginx/conf.d/vhostra.conf
    mkdir -p /var/log/nginx
    if [ "${1:-}" = --validate ]; then exec /usr/sbin/nginx -t; fi
    exec /usr/sbin/nginx -g 'daemon off;'
    ;;
  *) echo 'Unsupported Vhostra web server' >&2; exit 64 ;;
esac
