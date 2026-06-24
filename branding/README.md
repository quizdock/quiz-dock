# Branding (white-label)

Personnalisation de marque **sans rebuild**. Ce dossier est monté en volume dans le
conteneur frontend (`./branding` → racine servie), surchargeant les fichiers par défaut.

| Quoi | Comment |
|------|---------|
| **Nom de l'app** | Variable d'env `APP_NAME` (voir `.env`). Régénère `/config.js` au démarrage du conteneur. |
| **Logo** | Remplacer `branding/logo.svg` (servi à `/branding/logo.svg`). |
| **CSS d'override** | Éditer `branding/override.css` (chargée en dernier → surcharge tous les styles). |

Aucune reconstruction d'image nécessaire : changer `APP_NAME` puis `docker compose up -d`
relance l'entrypoint ; modifier `logo.svg`/`override.css` est pris en compte au prochain
chargement (volume en lecture seule).

Les valeurs par défaut vivent aussi dans `apps/frontend/public/` (utilisées en build et
si aucun volume n'est monté).
