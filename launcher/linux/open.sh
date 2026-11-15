#!/bin/sh
# Opens Oki's page in the browser, or with `folder` the host folder it shares.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
. "$here/common.sh"

case ${1:-page} in
  page) xdg-open "http://127.0.0.1:$port/oki/" ;;
  folder) xdg-open "$folder" ;;
  *) fail "open.sh takes page or folder" ;;
esac
