# SiteLock

SiteLock ajoute un écran de verrouillage local avant l’ouverture des sites choisis dans Chrome ou Edge sur un ordinateur partagé.

## Fonctionnement

- L’utilisateur colle une adresse complète ou saisit un domaine dans les réglages.
- SiteLock conserve uniquement le nom d’hôte : le protocole, le port, le chemin, les paramètres et le fragment sont ignorés.
- Une règle exacte, comme `planning.exemple.com`, protège uniquement cet hôte.
- Une règle avec sous-domaines, affichée `*.exemple.com`, protège le domaine racine et tous ses sous-domaines.
- Chaque règle utilise indépendamment un code basé sur l’heure et les minutes (`HHMM`), sa variante inversée (`MMHH`), ou un mot de passe personnalisé.
- Une validation réussie autorise uniquement le domaine correspondant dans l’onglet courant.
- La règle déclarative bloque normalement la navigation avant affichage. Un contrôle local au premier changement d’adresse complète cette protection dans les profils Edge où une redirection déclarative n’est exceptionnellement pas exécutée ; il ne lit pas le contenu de la page et ne nécessite pas l’autorisation `tabs`.
- Quitter le site protégé ou fermer l’onglet révoque automatiquement son autorisation.
- Fermer la dernière fenêtre du navigateur ou le redémarrer révoque tous les déverrouillages.
- Le popup SiteLock permet de tout reverrouiller immédiatement.
- Dans le tableau des sites protégés, une règle active peut afficher l’icône de son site. Uniquement lorsque les réglages sont déverrouillés, SiteLock tente de charger directement auprès de l’hôte `/favicon.ico`, puis `/favicon.png`. Ces requêtes omettent les identifiants et le référent ; seules des réponses de type image et de taille limitée sont acceptées. L’icône n’est ni stockée ni synchronisée, aucun service de favicon tiers n’est contacté et une initiale générique reste affichée en cas d’échec.
- Le tableau de bord conserve localement les 50 dernières réussites ou échecs avec le domaine, l’heure et le type de code utilisé. La valeur saisie et le chemin de la page ne sont jamais enregistrés, et l’historique peut être effacé.
- Un journal technique local, limité, copiable et effaçable aide à diagnostiquer les règles, permissions et cycles d’onglet sans enregistrer les codes saisis ni les chemins complets.
- L’administration du tableau de bord est protégée par un mot de passe maître. Son déverrouillage est limité à l’onglet de réglages courant ; une autre ouverture redemande le mot de passe.
- Une fois le tableau de bord déverrouillé par le mot de passe maître, les règles peuvent être ajoutées, modifiées ou supprimées sans redemander le code propre au site.

SiteLock traite uniquement les navigations principales HTTP et HTTPS. Il ne lit pas le contenu des pages, les cookies ou les formulaires.

## Synchronisation

Les règles, leur type de code, les vérificateurs cryptographiques salés des mots de passe personnalisés et le vérificateur du mot de passe maître sont enregistrés dans `chrome.storage.sync`. Lorsque la synchronisation du navigateur (Chrome Sync ou Edge Sync) est activée, ils sont retrouvés sur les autres navigateurs connectés au même compte. Aucun mot de passe en clair n’est enregistré.

Le navigateur ne synchronise ni les autorisations d’accès aux sites ni l’état déverrouillé du tableau de bord. Sur un nouvel appareil, l’utilisateur saisit le même mot de passe maître, retrouve ses règles, puis active les domaines en une seule demande d’autorisation. Aucun accès à un site n’est accordé à l’installation.

## Autorisations

- `storage` : synchronise les réglages et les vérificateurs cryptographiques, conserve temporairement l’état de l’onglet de réglages et les compteurs de tentatives, puis enregistre l’historique d’activité et le journal de diagnostic locaux, tous deux visibles et effaçables.
- `declarativeNetRequestWithHostAccess` : redirige localement les navigations protégées vers `lock.html`, puis autorise un onglet après validation.
- `optional_host_permissions` : déclare que SiteLock peut demander un domaine HTTP(S), mais l’extension ne demande que les domaines ajoutés explicitement par l’utilisateur. Cet accès applique le verrou et permet, lorsque le tableau de bord déverrouillé affiche une règle active, de tenter de charger son favicon directement depuis ce même hôte.

Les autorisations `tabs`, `scripting`, `webNavigation` et `webRequest` ne sont pas utilisées.

## Migration depuis Skellock

Lors de la mise à jour depuis la version 1.x, SiteLock crée une règle synchronisée `*.skello.io` qui conserve le code dynamique existant. La page de réglages s’ouvre une fois afin de présenter la nouvelle version et, si nécessaire, de réautoriser ce domaine sur l’appareil.

## Limites de sécurité

SiteLock est un verrou local de convenance pour un profil de navigateur. Un utilisateur capable de désactiver ou de supprimer l’extension, de changer de profil ou de navigateur peut le contourner. Pour une protection forte, utilisez aussi le verrouillage de la session de l’ordinateur et une politique de navigateur administrée.

Le mot de passe maître n’est pas récupérable par le développeur ou par SiteLock. Il protège l’administration mais ne remplace pas le code propre à chaque règle. Conservez donc aussi les éventuels mots de passe personnalisés des sites.

## Développement

Prérequis : Node.js et l’utilitaire `zip`.

```sh
npm test
npm run validate
npm run package
```

Le ZIP prêt à envoyer au Chrome Web Store est créé dans `dist/`.

## Mettre à jour la version publiée

1. Augmentez `version` dans `manifest.json` et `package.json`.
2. Exécutez `npm run package`.
3. Dans le Chrome Web Store Developer Dashboard, ouvrez la fiche existante.
4. Dans **Package**, téléversez le nouveau ZIP complet.
5. Mettez à jour la fiche et les déclarations de confidentialité si nécessaire, puis envoyez la mise à jour en examen.

La version déjà publiée reste disponible pendant l’examen de la nouvelle version.

Consultez [PRIVACY.md](PRIVACY.md) pour la politique de confidentialité et [STORE_LISTING.md](STORE_LISTING.md) pour les textes prêts à coller dans le formulaire de publication.
