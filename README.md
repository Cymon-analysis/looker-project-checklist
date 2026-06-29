# Checklist Projet Looker et Couche Sémantique

Checklist interactive partagée pour auditer la mise en place d'un projet Looker et d'une couche sémantique LookML.

**Page en ligne :** [https://cymon-analysis.github.io/looker-project-checklist/](https://cymon-analysis.github.io/looker-project-checklist/)

## Fonctionnalités

- 66 points de contrôle en 7 phases
- Instructions détaillées (vérification + mise en place) par point
- **Synchronisation en temps réel** entre appareils (Firebase Firestore)
- **Attribution** : qui a coché/décoché chaque point, avec horodatage
- Lien de partage pour collaborer (ex. avec une consultante)
- Saisie du prénom à la première visite

## Partager avec une consultante

1. Ouvrez la checklist
2. Cliquez **Copier le lien de partage**
3. Envoyez l'URL (contient `?room=...` — même salle = même données)
4. Elle entre son prénom et coche les points — vous voyez ses validations en direct

Pour un projet dédié, utilisez une URL du type :
`https://cymon-analysis.github.io/looker-project-checklist/?room=mon-audit-2026`

## Activer la synchronisation cloud

Par défaut, la progression est locale tant que Firebase n'est pas configuré.

Suivez le guide : [docs/CONFIGURATION-SYNC.md](docs/CONFIGURATION-SYNC.md) (5 minutes).

## Régénérer les données depuis le canvas

```bash
node generate.mjs
```

## Structure

| Fichier | Rôle |
|---------|------|
| `index.html` | Page principale |
| `app.js` | Logique interactive + sync Firebase |
| `data.js` | Données checklist (généré) |
| `firebase-config.js` | Config Firebase (généré au déploiement) |
| `styles.css` | Styles |
