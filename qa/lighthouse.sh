#!/bin/sh
set -eu
url="${PILOT_URL:-http://127.0.0.1:48732}"
evidence="${PILOT_EVIDENCE:-../../evidence}"
mkdir -p "$evidence"
for form in mobile desktop; do
  preset=''
  if [ "$form" = desktop ]; then preset='--preset=desktop'; fi
  ./node_modules/.bin/lighthouse "$url" $preset --quiet --chrome-flags='--headless --no-first-run' --output=json --output-path="$evidence/lighthouse-$form.json"
done
