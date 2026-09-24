# Generated Vhostra builds pass LSPHP_VERSION as 81, 82, 83, 84, or 85.
# The base image's bundled LSPHP must never decide the selected runtime.
FROM litespeedtech/openlitespeed:latest

ARG LSPHP_VERSION
RUN test -n "$LSPHP_VERSION" && case "$LSPHP_VERSION" in 81|82|83|84|85) ;; *) echo "Unsupported Vhostra LSPHP version: $LSPHP_VERSION" >&2; exit 64 ;; esac

# LiteSpeed's repository is required because the upstream OLS image only bundles
# one LSPHP version. Fail the build if the requested package cannot be resolved.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg supervisor mariadb-server redis-server memcached \
 && curl -fsSL https://repo.litespeed.sh | bash \
 && apt-get update \
 && apt-cache show "lsphp${LSPHP_VERSION}" >/dev/null \
 && apt-get install -y --no-install-recommends \
      "lsphp${LSPHP_VERSION}" "lsphp${LSPHP_VERSION}-mysql" \
 && test -x "/usr/local/lsws/lsphp${LSPHP_VERSION}/bin/lsphp" \
 && curl -fsSL --retry 3 -o /tmp/phpmyadmin.tar.gz https://files.phpmyadmin.net/phpMyAdmin/5.2.2/phpMyAdmin-5.2.2-all-languages.tar.gz \
 && mkdir -p /usr/share/phpmyadmin \
 && tar -xzf /tmp/phpmyadmin.tar.gz --strip-components=1 -C /usr/share/phpmyadmin \
 && rm -f /tmp/phpmyadmin.tar.gz \
 && rm -rf /var/lib/apt/lists/*

COPY phpmyadmin-config.inc.php /usr/share/phpmyadmin/config.inc.php
COPY supervisor.conf /etc/supervisor/conf.d/vhostra.conf
COPY entrypoint.sh /usr/local/bin/vhostra-entrypoint
RUN chmod 0755 /usr/local/bin/vhostra-entrypoint \
 && rm -rf /usr/local/lsws/Example/html \
 && ln -s /var/www/html /usr/local/lsws/Example/html

ENTRYPOINT ["/usr/local/bin/vhostra-entrypoint"]
