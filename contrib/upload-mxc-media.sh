#!/usr/bin/env bash

set -euo pipefail

mimetype=$(file --brief --mime-type "$1")
echo Detected MIME type of $1 as $mimetype.

read -p 'Input bearer token: ' bearer

echo Uploading $1...

curl --data-binary @"$1" 'https://matrix.seattlematrix.org/_matrix/media/v3/upload?filename='$(echo "$1" | tr '[^[:alnum:].]' '_') \
  -X 'POST' \
  -H 'Authorization: Bearer '"$bearer" \
  -H 'Content-Type: '$mimetype \
  --compressed
