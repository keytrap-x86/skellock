# Fiche Chrome Web Store — SiteLock 2.0.0

Téléversez d’abord `dist/sitelock-2.0.0.zip` sur la fiche existante. Le tableau de bord recalculera les autorisations à justifier à partir du nouveau manifeste.

## Objectif unique

> SiteLock ajoute un verrou local avant l’accès aux sites Internet choisis par l’utilisateur sur un ordinateur partagé, afin de réduire les consultations ou modifications non autorisées. Chaque site peut utiliser un code dynamique ou un mot de passe personnalisé, et l’administration des règles est protégée par un mot de passe maître.

## Justification de `storage`

> Cette autorisation enregistre les domaines protégés, leur portée et leur type de code dans `chrome.storage.sync` afin de retrouver les réglages sur les autres navigateurs connectés au même compte lorsque la synchronisation du navigateur est activée. Pour les mots de passe personnalisés et le mot de passe maître, seuls un sel et un vérificateur dérivé par PBKDF2-SHA-256 sont synchronisés ; aucun mot de passe en clair n’est enregistré. `chrome.storage.session` conserve pendant la session les compteurs nécessaires à la limitation des essais, ainsi que l’identifiant de l’onglet de réglages actuellement déverrouillé. `chrome.storage.local` conserve les 50 dernières réussites ou échecs avec le nom d’hôte, l’heure et le type de code, ainsi qu’un journal technique circulaire limité aux événements de démarrage, de règle, de permission et d’onglet. Ces deux journaux sont visibles et effaçables dans le tableau de bord ; aucune valeur saisie, aucun contenu de page ni aucun chemin complet n’y figure.

## Justification de `declarativeNetRequestWithHostAccess`

> Cette autorisation permet à Chrome de rediriger uniquement les navigations principales correspondant aux domaines configurés vers la page locale de verrouillage, puis d’autoriser temporairement le domaine dans l’onglet après validation du code. Les règles sont appliquées localement par Chrome sans intercepter ni lire le contenu des requêtes ou des pages. L’autorisation temporaire disparaît dès que l’onglet quitte le domaine protégé, à la fermeture de l’onglet, à la fermeture de la dernière fenêtre ou au redémarrage du navigateur.

SiteLock complète cette règle par un contrôle local au premier changement d’adresse si un profil Edge n’exécute exceptionnellement pas la redirection déclarative. Ce contrôle utilise uniquement les opérations standard de navigation d’onglet, ne lit aucun contenu de page et ne nécessite pas l’autorisation `tabs`.

## Justification de l’autorisation facultative d’accès aux hôtes

> SiteLock doit pouvoir protéger un domaine HTTP(S) choisi librement par l’utilisateur. La portée facultative `*://*/*` n’accorde aucun accès à l’installation. Après une action explicite, SiteLock demande seulement l’origine sélectionnée ou sa portée avec sous-domaines. Cet accès applique le verrou local et, uniquement dans le tableau de bord déverrouillé, tente de charger `/favicon.ico`, puis `/favicon.png`, directement depuis chaque hôte protégé actif. Les requêtes utilisent `credentials: "omit"` et `referrerPolicy: "no-referrer"` ; seules des images d’un type autorisé et d’une taille limitée sont acceptées. À défaut, une icône générique s’affiche. Aucun script n’est injecté et aucun service de favicon tiers n’est utilisé.

La déclaration large dans `optional_host_permissions` est nécessaire pour accepter n’importe quel domaine choisi à l’avenir ; les autorisations réellement accordées restent limitées aux choix de l’utilisateur et propres à chaque appareil.

`web_accessible_resources` expose uniquement `lock.html` aux origines HTTP(S), car Chrome doit pouvoir rediriger tout domaine choisi par l’utilisateur vers cette page locale. Cette déclaration n’accorde aucun accès à un hôte et n’expose aucun script, réglage ou mot de passe.

## Code distant

Sélectionner **Non, je n’utilise pas de code distant**.

> Tout le code JavaScript, HTML et CSS exécuté est inclus dans le package de l’extension. Aucun script distant, `eval`, interpréteur de commandes téléchargées ou WebAssembly distant n’est utilisé. Les favicons éventuellement récupérés directement depuis les hôtes protégés sont traités uniquement comme des images de type et de taille limités ; leur contenu n’est jamais exécuté. SiteLock n’effectue aucun appel vers un serveur du développeur ni vers un service de favicon tiers.

## Déclarations relatives aux données

Déclarer les catégories suivantes, même si leur traitement reste local :

- **Informations d’authentification** : oui — un mot de passe personnalisé ou maître peut être transformé et vérifié localement ; seuls leurs vérificateurs cryptographiques salés peuvent être synchronisés par le navigateur ;
- **Historique Web / activité de navigation** : oui — SiteLock traite uniquement les navigations principales correspondant aux domaines que l’utilisateur a choisi de protéger ;
- toutes les autres catégories : non.

Certifier les engagements d’utilisation limitée : aucune vente, aucun transfert par le développeur à des tiers, aucune publicité, aucune utilisation sans rapport avec l’objectif unique, aucune utilisation pour la solvabilité et aucun accès humain aux données.

URL de la politique de confidentialité, après publication de ce fichier sur la branche principale :

`https://github.com/keytrap-x86/skellock/blob/main/PRIVACY.md`

## Fiche publique

Description courte :

> Protégez l’accès aux sites choisis sur un ordinateur partagé avec un verrou local simple.

Description détaillée :

> SiteLock ajoute un écran de verrouillage local avant l’ouverture des sites sensibles de votre choix dans Chrome.
>
> Collez simplement une adresse complète ou saisissez un domaine. SiteLock extrait automatiquement le nom du site et vous permet de protéger uniquement ce domaine ou également tous ses sous-domaines.
>
> Fonctionnalités :
>
> - règles exactes ou avec sous-domaines pour chaque site ;
> - code dynamique, code dynamique inversé ou mot de passe personnalisé par règle ;
> - tableau clair des sites protégés avec leur favicon chargé directement depuis l’hôte actif, ou une icône générique en cas d’échec ;
> - tableau de bord protégé par un mot de passe maître, redemandé dans chaque nouvel onglet d’administration ;
> - réglages retrouvés sur vos autres appareils lorsque la synchronisation de Chrome ou Edge est activée ;
> - activation des domaines synchronisés en une seule demande par nouvel appareil ;
> - déverrouillage limité à l’onglet et au site courant, révoqué dès que l’utilisateur quitte ce site ou ferme l’onglet ;
> - reverrouillage immédiat de tous les onglets depuis le popup ;
> - historique local et effaçable des 50 dernières réussites ou échecs, sans conserver les codes saisis ;
> - diagnostic technique local, copiable et effaçable, sans codes saisis ni chemins complets ;
> - ajout, modification et suppression des règles depuis le tableau de bord protégé par mot de passe maître ;
> - aucune lecture du contenu des pages, aucune publicité, aucune télémétrie et aucun suivi externe.
>
> SiteLock ne reçoit aucun accès à un site lors de l’installation. L’autorisation de chaque domaine est demandée uniquement après son ajout explicite.
>
> Pour faciliter l’identification visuelle des règles actives, le tableau de bord déverrouillé peut tenter de récupérer `/favicon.ico`, puis `/favicon.png`, directement depuis le site protégé, sans identifiants ni référent. Aucun service de favicon tiers n’est utilisé et une icône générique est affichée si aucune image sûre et suffisamment petite n’est disponible.
>
> SiteLock fournit un verrou local de convenance et ne remplace pas le verrouillage de la session de l’ordinateur, les contrôles d’accès du site ou les politiques de sécurité de l’entreprise. Un utilisateur pouvant désactiver ou supprimer l’extension, changer de profil ou utiliser un autre navigateur peut contourner ce verrou.

- Catégorie suggérée : **Productivité**
- Contenu adulte : **Non**
- Achats intégrés : **Non**
- Fonctionnement en navigation privée : **Non**

## Instructions privées pour l’équipe de vérification

1. Installer l’extension et vérifier que la page de réglages s’ouvre automatiquement.
2. Créer et confirmer le mot de passe maître `SiteLock-Master-2026`.
3. Dans **Adresse du site**, saisir `example.com`.
4. Choisir **Ce domaine uniquement**, puis **Mot de passe personnalisé**.
5. Saisir et confirmer `SiteLock-Test-2026`, puis cliquer sur **Ajouter et autoriser**.
6. Accepter la demande d’accès à `example.com`.
7. Vérifier dans le tableau que `example.com` affiche son favicon si l’hôte en fournit un, ou son initiale générique dans le cas contraire.
8. Accéder à `https://example.com/?sitelock-review=1`.
9. Vérifier que la page de verrouillage locale affiche `example.com`.
10. Saisir un mot de passe incorrect, puis `SiteLock-Test-2026`.
11. Vérifier que l’adresse complète d’origine est restaurée.
12. Revenir au tableau de bord et vérifier que l’échec puis la réussite apparaissent avec le type **Mot de passe**.
13. Ouvrir un nouvel onglet de réglages et vérifier que `SiteLock-Master-2026` est demandé avant d’afficher les règles.
14. Ouvrir le popup SiteLock, cliquer sur **Verrouiller maintenant**, puis actualiser `example.com` et vérifier le retour du verrou.

Aucun compte sur un site tiers n’est nécessaire pour ce test.

## Mise à jour de la fiche déjà publiée

1. Conserver la fiche Chrome Web Store existante.
2. Ouvrir l’onglet **Package** et téléverser le ZIP complet de la version `2.0.0`.
3. Remplacer le nom, les descriptions, les captures et les déclarations de confidentialité par les textes SiteLock.
4. Vérifier que seuls `storage`, `declarativeNetRequestWithHostAccess` et l’accès hôte facultatif apparaissent.
5. Enregistrer, puis envoyer la mise à jour en examen.

La version actuellement approuvée reste publiée pendant l’examen. Les utilisateurs de la version 1.x recevront une migration automatique de leur règle Skello lors du déploiement de la version 2.0.0.
