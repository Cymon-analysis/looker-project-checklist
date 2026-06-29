# Configuration de la synchronisation

La checklist synchronise l'état via un fichier JSON dans ce dépôt (`sync/{room}.json`).

## Activation (administrateur — une seule fois)

1. Créez un **token d'accès fine-grained** GitHub :
   [Créer le token pré-rempli](https://github.com/settings/personal-access-tokens/new?name=Looker+Checklist+Sync&description=Synchronisation+checklist+Looker&contents=write&metadata=read&expires_in=none)

2. Sélectionnez le dépôt **looker-project-checklist** uniquement.

3. Ajoutez le secret dans GitHub :
   - Dépôt → **Settings** → **Secrets and variables** → **Actions**
   - Nom : `SYNC_GITHUB_TOKEN`
   - Valeur : le token copié

4. Relancez le workflow **Deploy GitHub Pages** (onglet Actions).

## Partage

Envoyez le lien avec `?room=mon-projet` à votre consultante. Les coches se synchronisent toutes les 3 secondes.

## Note sécurité

Le token est intégré côté client pour permettre les écritures depuis le navigateur. Il est limité à ce dépôt et ne contient que des coches de checklist (aucune donnée sensible).
