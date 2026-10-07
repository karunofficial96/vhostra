#!/bin/sh
set -eu

root="${1:?certificate root required}"
names="${2:?TLS names required}"
key="$root/private/localhost.key"
cert="$root/public/localhost.pem"
marker="$root/public/names.txt"

fail() { echo "Published TLS certificate is invalid: $1" >&2; exit 1; }

link_count() {
  stat -c %h "$1" 2>/dev/null || stat -f %l "$1" 2>/dev/null
}

for file in "$key" "$cert" "$marker"; do
  [ -f "$file" ] && [ ! -L "$file" ] || fail 'missing or linked file'
  [ "$(link_count "$file")" = 1 ] || fail 'hard-linked file'
done
[ "$(cat "$marker")" = "$names" ] || fail 'stale names'
openssl x509 -checkend 86400 -noout -in "$cert" >/dev/null 2>&1 || fail 'expired certificate'
openssl x509 -in "$cert" -noout -ext subjectAltName 2>/dev/null | grep -q 'X509v3 Subject Alternative Name' || fail 'missing subject alternative names'
openssl pkey -in "$key" -passin pass: -noout >/dev/null 2>&1 || fail 'unreadable private key'

key_public="$(openssl pkey -in "$key" -passin pass: -pubout -outform DER 2>/dev/null | openssl dgst -sha256)"
cert_public="$(openssl x509 -in "$cert" -pubkey -noout 2>/dev/null | openssl pkey -pubin -outform DER 2>/dev/null | openssl dgst -sha256)"
[ "$key_public" = "$cert_public" ] || fail 'private key does not match certificate'

case "$names" in
  DNS:localhost,IP:127.0.0.1|DNS:localhost,IP:127.0.0.1,*) ;;
  *) fail 'invalid required names' ;;
esac
set -f
old_ifs="$IFS"
IFS=,
set -- $names
IFS="$old_ifs"
for name do
  case "$name" in
    DNS:*)
      host="${name#DNS:}"
      [ -n "$host" ] && [ "$host" != "$name" ] || fail 'invalid DNS name'
      openssl x509 -in "$cert" -noout -checkhost "$host" >/dev/null 2>&1 || fail "missing DNS name: $host"
      ;;
    IP:*)
      ip="${name#IP:}"
      [ -n "$ip" ] || fail 'invalid IP name'
      openssl x509 -in "$cert" -noout -checkip "$ip" >/dev/null 2>&1 || fail "missing IP name: $ip"
      ;;
    *) fail 'invalid TLS name' ;;
  esac
done
