#!/bin/sh
# Stops Oki. The shared folder and the instance's disk stay as they are.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
. "$here/common.sh"

status=$(status_of)
[ -n "$status" ] || fail "there is no instance $name — start.sh makes it"
if [ "$status" = Stopped ]; then
  echo "oki: stopped"
else
  limactl stop "$name"
fi
