#!/bin/sh
# White-label runtime : régénère /config.js depuis l'env au démarrage du conteneur,
# pour surcharger le nom d'app ET la langue SANS rebuild (cf. apps/frontend/src/config.ts).
# Déposé dans /docker-entrypoint.d/ → exécuté par l'entrypoint nginx avant le start.
set -e

: "${APP_NAME:=QuizDock}"
: "${APP_LANG:=en}"
# Échappe les guillemets doubles pour rester un littéral JS valide.
escaped=$(printf '%s' "$APP_NAME" | sed 's/"/\\"/g')
escaped_lang=$(printf '%s' "$APP_LANG" | sed 's/"/\\"/g')

cat > /usr/share/nginx/html/config.js <<EOF
window.__APP_CONFIG__ = { appName: "${escaped}", lang: "${escaped_lang}" };
EOF

echo "[entrypoint] config.js généré (appName=\"${APP_NAME}\", lang=\"${APP_LANG}\")"
