# Skellock

Skellock ajoute un écran de verrouillage local avant l’ouverture de Skello dans Chrome sur un ordinateur partagé.

## Fonctionnement

- Les navigations principales vers `https://*.skello.io/*` sont redirigées vers une page de verrouillage fournie par l’extension.
- Une validation réussie autorise uniquement l’onglet courant.
- La fermeture de l’onglet révoque automatiquement son autorisation.
- Un clic sur l’icône Skellock reverrouille et recharge tous les onglets Skello.
- Aucun contenu de planning, cookie ou identifiant Skello n’est lu.
- Aucune donnée n’est envoyée au développeur ou à un tiers.

Skellock est une extension indépendante, non affiliée à Skello. Elle fournit un verrou local de convenance : elle ne remplace pas le verrouillage de la session de l’ordinateur, les contrôles d’accès du compte Skello ou une politique Chrome gérée.

## Développement

Prérequis : Node.js et l’utilitaire `zip`.

```sh
npm test
npm run validate
npm run package
```

Le ZIP prêt à envoyer au Chrome Web Store est créé dans `dist/`.

Consultez [PRIVACY.md](PRIVACY.md) pour la politique de confidentialité et [STORE_LISTING.md](STORE_LISTING.md) pour les textes du formulaire de publication.
