# Generated Vhostra builds pass LSPHP_VERSION as 81, 82, 83, 84, or 85.
# The base image's bundled LSPHP must never decide the selected runtime.
FROM litespeedtech/openlitespeed:latest

ARG LSPHP_VERSION
ARG LSPHP_EXTENSIONS=""
ARG VHOSTRA_CWEBP=true
RUN test -n "$LSPHP_VERSION" && case "$LSPHP_VERSION" in 81|82|83|84|85) ;; *) echo "Unsupported Vhostra LSPHP version: $LSPHP_VERSION" >&2; exit 64 ;; esac

# LiteSpeed's repository is required because the upstream OLS image only bundles
# one LSPHP version. Fail the build if the requested package cannot be resolved.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates openssl curl gnupg supervisor apache2 nginx mariadb-server redis-server memcached netcat-openbsd \
 && curl -fsSL https://repo.litespeed.sh | bash \
 && apt-get update \
 && apt-cache show "lsphp${LSPHP_VERSION}" >/dev/null \
 && for package in redis memcached; do apt-cache show "lsphp${LSPHP_VERSION}-${package}" >/dev/null || { echo "Vhostra build error: LSPHP ${LSPHP_VERSION} does not provide ${package}" >&2; exit 65; }; done \
 && extension_packages='' \
 && for extension in $(printf '%s' "$LSPHP_EXTENSIONS" | tr ',' ' '); do \
      case "$extension" in '' ) ;; *[!a-z0-9-]* ) echo "Invalid Vhostra LSPHP extension: $extension" >&2; exit 66 ;; \
        *) package="lsphp${LSPHP_VERSION}-${extension}"; apt-cache show "$package" >/dev/null || { echo "Vhostra build error: LSPHP ${LSPHP_VERSION} does not provide ${extension}" >&2; exit 65; }; extension_packages="$extension_packages $package" ;; esac; \
    done \
 && opcache_package='' \
 && if apt-cache show "lsphp${LSPHP_VERSION}-opcache" >/dev/null 2>&1; then opcache_package="lsphp${LSPHP_VERSION}-opcache"; fi \
 && cwebp_package='' \
 && if [ "$VHOSTRA_CWEBP" = true ]; then apt-cache show webp >/dev/null || { echo 'Vhostra build error: the webp package is unavailable' >&2; exit 67; }; cwebp_package='webp'; fi \
 && apt-get install -y --no-install-recommends \
      "lsphp${LSPHP_VERSION}" "lsphp${LSPHP_VERSION}-mysql" "lsphp${LSPHP_VERSION}-redis" "lsphp${LSPHP_VERSION}-memcached" \
      $extension_packages $opcache_package $cwebp_package \
 && test -x "/usr/local/lsws/lsphp${LSPHP_VERSION}/bin/lsphp" \
 && curl -fsSL --retry 3 -o /tmp/phpmyadmin.tar.gz https://files.phpmyadmin.net/phpMyAdmin/5.2.2/phpMyAdmin-5.2.2-all-languages.tar.gz \
 && mkdir -p /usr/share/phpmyadmin \
 && tar -xzf /tmp/phpmyadmin.tar.gz --strip-components=1 -C /usr/share/phpmyadmin \
 && rm -f /tmp/phpmyadmin.tar.gz

COPY phpmyadmin-config.inc.php /usr/share/phpmyadmin/config.inc.php
COPY supervisor.conf /etc/supervisor/conf.d/vhostra.conf
COPY entrypoint.sh /usr/local/bin/vhostra-entrypoint
RUN chmod 0755 /usr/local/bin/vhostra-entrypoint \
 && cp /usr/local/lsws/conf/httpd_config.conf /usr/local/lsws/conf/httpd_config.vhostra-base.conf \
 && rm -rf /usr/local/lsws/Example/html \
 && ln -s /var/www/html /usr/local/lsws/Example/html

ENTRYPOINT ["/usr/local/bin/vhostra-entrypoint"]

COPY web-server.sh /usr/local/bin/vhostra-web-server
RUN chmod 0755 /usr/local/bin/vhostra-web-server && a2enmod rewrite proxy proxy_http && a2dissite 000-default
