#!/usr/bin/env bash
# shellcheck shell=bash

# This script will retrieve all *regular* rooms that are part of a space.
# That means talk rooms and statically specified rooms (e.g. "Info Desk"),
# but not rooms that are functioning as the root of a (sub)space.
#
# You get a stream of JSON objects that you can filter with jq. For example,
# you might want to:
#
#     ./list-space-child-rooms.sh | jq .room_id | xargs -n 1 curl ...

set -Eeuxo pipefail

# Reference: https://spec.matrix.org/latest/client-server-api/
api() {
  # TODO: Show full request and response on stderr
  http --check-status --ignore-stdin \
    "$1" "https://matrix.seattlematrix.org/_matrix/client/$2" \
    "Authorization:Bearer $MATRIX_ACCESS_TOKEN" \
    "${@:3}"
}

root_space_id="$1"

# Validate credentials
[[ "$(api get 'v3/account/whoami' | jq --raw-output '.user_id')" == '@seagl-bot:seattlematrix.org' ]]

# Spits out sequences of JSON objects. jq handles this fine, as a stream of documents.
recurse_paginate() {
  if [[ -z "${1+x}" ]]; then
    querystring=''
  else
    querystring="?from=$1"
  fi

  res="$(api get "v1/rooms/$root_space_id/hierarchy$querystring")"
  echo "$res" | jq '.rooms[] | select(.room_type == null)'

  next=$(echo "$res" | jq -r .next_batch)
  if [[ $next != null ]]; then
    recurse_paginate $next
  fi
}
recurse_paginate
