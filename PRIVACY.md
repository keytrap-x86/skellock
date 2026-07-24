# Politique de confidentialité de SiteLock

Dernière mise à jour : 24 juillet 2026

SiteLock est une extension indépendante conçue pour ajouter un verrou local avant l’accès aux sites choisis sur un ordinateur partagé.

## Données traitées

SiteLock traite uniquement :

- les noms d’hôte que l’utilisateur choisit de protéger, leur portée et leur type de code ;
- le mot de passe personnalisé éventuellement saisi, uniquement le temps de produire ou de vérifier localement un vérificateur cryptographique salé ;
- le mot de passe maître, uniquement le temps de produire ou de vérifier localement son propre vérificateur cryptographique salé ;
- le fait qu’une navigation principale vise un domaine protégé, ainsi que l’adresse de destination nécessaire pour reprendre cette navigation après déverrouillage ;
- le nombre de tentatives échouées et la date de fin d’un éventuel blocage temporaire ;
- pour les 50 dernières tentatives, le nom d’hôte, la portée de la règle, l’issue réussie ou échouée, le type de code configuré et l’heure.
- dans un journal de diagnostic local et limité, l’heure, la version de l’extension, le type d’événement technique, l’identifiant numérique de l’onglet lorsque nécessaire, le nom d’hôte ou la règle concernée et des compteurs de règles ou d’autorisations.

SiteLock ne lit pas le contenu HTML des pages, les cookies, les identifiants de compte, les données de formulaire ou les communications.

## Stockage et synchronisation

Les domaines protégés, leur portée, leur type de code et, pour un mot de passe personnalisé, son sel, son nombre d’itérations et son vérificateur dérivé sont enregistrés dans `chrome.storage.sync`. Le sel, le nombre d’itérations et le vérificateur dérivé du mot de passe maître y sont également enregistrés. Ces réglages sont synchronisés avec les autres navigateurs connectés au même compte lorsque la synchronisation du navigateur (Chrome Sync ou Edge Sync) est activée. Si elle est désactivée, le navigateur les conserve localement.

Les mots de passe personnalisés et le mot de passe maître ne sont jamais enregistrés ni synchronisés en clair. Les vérificateurs salés ne sont toutefois pas des données chiffrées et peuvent faire l’objet de tentatives hors ligne ; SiteLock impose donc un minimum de huit caractères.

Les compteurs utilisés pour limiter les essais, l’identifiant de l’onglet de réglages déverrouillé et les autorisations temporaires d’onglet sont conservés uniquement pour la session du navigateur dans `chrome.storage.session` et dans les règles de session du navigateur. Un autre onglet de réglages reste verrouillé. Ces données disparaissent à la fin de la session.

L’historique des 50 dernières réussites ou échecs est enregistré dans `chrome.storage.local` sur l’appareil où ils se produisent. Il n’est pas synchronisé. Il contient uniquement le nom d’hôte, la règle correspondante, l’issue, le type de code et l’heure ; il ne contient jamais la valeur saisie ni le chemin complet de la page. L’utilisateur peut l’effacer à tout moment depuis le tableau de bord.

Le journal de diagnostic technique est également enregistré dans `chrome.storage.local` sous la forme d’une liste circulaire limitée. Il n’est pas synchronisé et ne contient jamais de code saisi, de mot de passe, de contenu de page ni d’adresse complète. L’utilisateur peut l’afficher, le copier ou l’effacer depuis le tableau de bord. Lors de la copie, le rapport ajoute la chaîne d’identification et la plateforme déclarées par le navigateur afin d’identifier sa version. Il n’est transmis au développeur que si l’utilisateur choisit lui-même de copier puis d’envoyer ce diagnostic.

L’adresse de destination est transportée temporairement dans le fragment de la page locale de verrouillage. SiteLock ne conserve ni ne synchronise l’adresse complète, son chemin, ses paramètres ou son fragment dans l’historique d’activité.

## Autorisations d’accès aux sites

SiteLock ne reçoit aucun accès à un site lors de son installation. Une autorisation facultative est demandée uniquement lorsque l’utilisateur ajoute ou active un domaine. Ces autorisations sont propres à chaque appareil et ne sont pas synchronisées par le navigateur.

Lorsque le tableau de bord déverrouillé affiche une règle active sur l’appareil, SiteLock peut tenter de récupérer son icône directement auprès de l’hôte protégé, d’abord à l’adresse `/favicon.ico`, puis à `/favicon.png`. Ces requêtes utilisent `credentials: "omit"` et `referrerPolicy: "no-referrer"` : elles n’envoient donc ni cookies, ni identifiants HTTP, ni adresse de page référente. Comme pour toute connexion directe, l’hôte peut recevoir les informations réseau habituellement transmises par le navigateur, notamment l’adresse IP. La réponse n’est utilisée que si son type est une image autorisée et si sa taille reste sous la limite prévue par l’extension. Sinon, une icône générique avec l’initiale du domaine est affichée.

Les favicons récupérés servent uniquement à l’affichage du tableau courant. Ils ne sont ni enregistrés ni synchronisés. SiteLock ne contacte aucun service de favicon tiers et ne tente aucune récupération pour une règle inactive ou lorsque les réglages sont verrouillés.

## Transmission et partage

Le développeur ne reçoit aucune donnée. SiteLock n’utilise aucun serveur, service d’analyse, publicité, outil de suivi ou service de favicon tiers. Les requêtes d’icône décrites ci-dessus sont adressées directement au site que l’utilisateur a choisi de protéger. Aucune donnée n’est vendue, louée ou partagée avec un tiers par le développeur.

La synchronisation éventuelle des réglages est fournie par le navigateur et le compte de synchronisation de l’utilisateur, conformément aux paramètres de ce dernier.

## Utilisation limitée

Les données sont utilisées exclusivement pour fournir la fonction de verrouillage décrite ci-dessus. L’utilisation des informations reçues des API Google respecte la Politique relative aux données utilisateur du Chrome Web Store, y compris les exigences d’utilisation limitée.

## Contrôle par l’utilisateur

L’utilisateur peut modifier ou supprimer chaque règle depuis les réglages de SiteLock, changer son mot de passe maître, effacer l’historique local et effacer le journal de diagnostic. La suppression d’une règle révoque l’autorisation d’hôte correspondante. La désinstallation supprime les données locales et les règles appartenant à l’extension ; les données synchronisées sont gérées par le navigateur.

Le développeur et SiteLock ne peuvent pas récupérer un mot de passe maître oublié. Le mot de passe maître protège l’administration de l’extension mais ne remplace pas les mots de passe personnalisés configurés pour les sites.

## Limites

SiteLock est un verrou local de convenance. Il ne remplace pas le verrouillage de la session de l’ordinateur, les contrôles d’accès du site protégé ou une politique de navigateur administrée.

## Contact

Pour toute question relative à cette politique, utilisez le [suivi public du projet](https://github.com/keytrap-x86/skellock/issues).
