# Fiche Chrome Web Store

Ces textes correspondent à la version `1.1.0`. Téléversez d’abord le nouveau ZIP : les champs `storage`, `scripting`, `tabs` et l’ancien champ `declarativeNetRequest` doivent disparaître.

## Objectif unique

> Skellock ajoute sur les ordinateurs partagés un verrou local par code avant les navigations vers le site Skello (`skello.io`), afin de réduire le risque de consultation ou de modification non autorisée des plannings par un membre de l’équipe. L’extension n’agit sur aucun autre site.

## Justification de `declarativeNetRequestWithHostAccess`

> Cette autorisation permet à Chrome de rediriger uniquement les navigations principales vers `skello.io` vers la page locale de verrouillage, puis d’autoriser temporairement l’onglet après validation locale du code. Les règles sont appliquées par Chrome sans que l’extension intercepte ou lise le contenu des requêtes. Aucun autre domaine, aucune sous-ressource et aucun contenu de page ne sont modifiés.

## Justification de l’accès à l’hôte

> L’accès hôte est strictement limité à `https://*.skello.io/*`. Il est indispensable pour appliquer la règle de redirection uniquement aux pages Skello. L’extension ne lit pas le contenu des plannings, les cookies, les identifiants du compte Skello ni les données de formulaire, n’injecte aucun script et n’agit sur aucun autre site.

## Code distant

Sélectionner **Non, je n’utilise pas de code distant**.

> Tout le code JavaScript, HTML et CSS exécuté est inclus dans le package de l’extension. Aucun script distant, `eval`, interpréteur de commandes téléchargées ou WebAssembly distant n’est utilisé. L’extension n’effectue aucun appel vers un serveur du développeur.

## Déclarations relatives aux données

Déclarer les catégories suivantes, même si leur traitement reste local :

- **Informations d’authentification** : oui — le code saisi est comparé localement en mémoire, puis abandonné ;
- **Historique Web / activité de navigation** : oui — Chrome détecte uniquement les navigations principales vers le domaine Skello afin d’appliquer le verrou ;
- toutes les autres catégories : non.

Certifier les engagements d’utilisation limitée : aucune vente, aucun transfert à des tiers, aucune publicité, aucune utilisation sans rapport avec l’objectif unique, aucune utilisation pour la solvabilité et aucun accès humain aux données.

URL de la politique de confidentialité, après publication de ce fichier sur la branche principale :

`https://github.com/keytrap-x86/skellock/blob/main/PRIVACY.md`

## Fiche publique

Description courte :

> Ajoute un verrou local par code avant l’accès à Skello sur un ordinateur partagé.

Description détaillée :

> Skellock ajoute un écran de verrouillage local avant l’ouverture de Skello dans Chrome. Le responsable connaît le code d’accès utilisé sur l’ordinateur partagé. Tant que celui-ci n’a pas été validé, les navigations vers `skello.io` sont redirigées vers l’écran de verrouillage.
>
> Fonctionnalités :
>
> - validation locale du code d’accès ;
> - autorisation limitée à l’onglet courant et révoquée à sa fermeture ;
> - reverrouillage immédiat de tous les onglets depuis l’icône Skellock ;
> - protection limitée aux domaines HTTPS de Skello ;
> - aucune lecture du contenu des plannings ou des données du compte Skello ;
> - aucune publicité, aucun suivi et aucun transfert de données.
>
> Skellock est une extension indépendante, non affiliée à Skello. Elle fournit un verrou local de convenance et ne remplace pas le verrouillage de la session de l’ordinateur, les contrôles d’accès du compte Skello ou les politiques de sécurité de l’entreprise. Un utilisateur pouvant désactiver ou supprimer l’extension, changer de profil ou utiliser un autre navigateur peut contourner ce verrou.

- Catégorie suggérée : **Productivité**
- Contenu adulte : **Non**
- Achats intégrés : **Non**

## Instructions privées pour l’équipe de vérification

Indiquer dans le champ privé de test la règle permettant à l’équipe Chrome Web Store de calculer le code de test. Ne pas ajouter cette règle à la description publique.

1. Installer l’extension.
2. Accéder à `https://app.skello.io/`.
3. Vérifier que l’écran de verrouillage s’affiche avant Skello.
4. Saisir un code incorrect, puis le code de test.
5. Vérifier l’ouverture de la page de connexion Skello.
6. Fermer l’onglet, ouvrir à nouveau Skello et vérifier que le verrou est revenu.
7. Déverrouiller, puis cliquer sur l’icône Skellock et vérifier le reverrouillage.

Aucun compte Skello n’est nécessaire pour tester le verrou.
