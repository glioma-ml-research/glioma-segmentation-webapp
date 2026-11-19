#!/bin/sh
# Starts as root only to make sure the mounted data folder belongs to the app
# user, then drops to that user for good: the server never runs as root.
set -eu
mkdir -p "${GLIOMA_DATA_DIR:-/data}"
chown -R glioma:glioma "${GLIOMA_DATA_DIR:-/data}"
chmod 700 "${GLIOMA_DATA_DIR:-/data}"
exec setpriv --reuid=glioma --regid=glioma --init-groups --no-new-privs "$@"
