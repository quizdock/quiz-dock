#!/bin/sh
# White-label runtime : régénère /config.js depuis l'env au démarrage du conteneur,
# pour surcharger le nom d'app, la langue et le logo SANS rebuild (cf. apps/frontend/src/config.ts).
# Déposé dans /docker-entrypoint.d/ → exécuté par l'entrypoint nginx avant le start.
set -e

: "${APP_NAME:=QuizDock}"
: "${APP_LANG:=en}"
# Échappe les guillemets doubles pour rester un littéral JS valide.
escaped=$(printf '%s' "$APP_NAME" | sed 's/"/\\"/g')
escaped_lang=$(printf '%s' "$APP_LANG" | sed 's/"/\\"/g')
# Vide (le défaut) = le SPA cherche le logo dans `branding/`, tous formats web.
escaped_logo=$(printf '%s' "${APP_LOGO_URL:-}" | sed 's/"/\\"/g')
# Where the home page's "report a bug / suggest…" links lead: empty = the QuizDock
# repository, another URL = the operator's, `none` = no such links.
escaped_feedback=$(printf '%s' "${APP_FEEDBACK_URL:-}" | sed 's/"/\\"/g')

cat > /usr/share/nginx/html/config.js <<EOF
window.__APP_CONFIG__ = { appName: "${escaped}", lang: "${escaped_lang}", logoUrl: "${escaped_logo}", feedbackUrl: "${escaped_feedback}" };
EOF

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

echo "[entrypoint] config.js généré (appName=\"${APP_NAME}\", lang=\"${APP_LANG}\")"
