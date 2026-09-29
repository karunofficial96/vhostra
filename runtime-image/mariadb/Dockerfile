# Match the recorded datadir series; never perform an implicit major upgrade.
ARG MARIADB_SERIES=11.8
FROM mariadb:${MARIADB_SERIES}
USER root
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends socat logrotate procps && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY entrypoint.sh /usr/local/bin/vhostra-mariadb
COPY logrotate.conf /etc/vhostra-logrotate.conf
RUN chmod 0755 /usr/local/bin/vhostra-mariadb
ENTRYPOINT ["/usr/local/bin/vhostra-mariadb"]
