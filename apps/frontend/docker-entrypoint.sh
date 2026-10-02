#!/bin/sh
# The installed app's name, at the container's start (before nginx): placed in
# /docker-entrypoint.d/, run by nginx's entrypoint. The runtime configuration
# (/config.js) is the backend's, proxied by nginx.conf.
set -e

: "${APP_NAME:=QuizDock}"
: "${APP_LANG:=en}"

# The installed app's name (PWA): the built manifest, renamed for the instance —
# from the pristine copy the image ships (manifest.base.webmanifest; the web root
# takes no new file), so a restart with another APP_NAME renames it again.
# Escaped twice: for a JSON string (\ and "), then for sed's replacement (\ & |).
json_sed() { printf '%s' "$1" | sed 's/[\\"]/\\&/g' | sed 's/[\\&|]/\\&/g'; }
web=/usr/share/nginx/html
name=$(json_sed "$APP_NAME")
lang=$(json_sed "$APP_LANG")
sed "s|\"name\": \"QuizDock\"|\"name\": \"${name}\"|; s|\"short_name\": \"QuizDock\"|\"short_name\": \"${name}\"|; s|\"lang\": \"en\"|\"lang\": \"${lang}\"|" \
  "$web/manifest.base.webmanifest" > "$web/manifest.webmanifest"

echo "[entrypoint] manifest named (name=\"${APP_NAME}\", lang=\"${APP_LANG}\")"
