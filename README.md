# Vue groupée DSFR — widget personnalisé Grist

Widget Grist qui affiche une table sous forme de volets dépliants, avec le design du
[Système de design de l'État (DSFR)](https://www.systeme-de-design.gouv.fr/).

## Fonctionnalités

- Regroupement sur **1 ou 2 niveaux imbriqués**
- Ordre des groupes : A→Z, Z→A, effectif ↑/↓ ou **manuel** (glisser-déposer, toutes les valeurs possibles listées)
- État à l'ouverture configurable par niveau : tous pliés, seul le premier déplié, tous dépliés
- **Édition des cellules** avec un éditeur adapté au type de colonne Grist (texte, nombre, booléen,
  date, date et heure, choix, liste de choix, référence, liste de références)
- Largeur des colonnes ajustable (glisser le bord de l'en-tête, double-clic pour réinitialiser)
- Configuration dans une fenêtre (roue dentée), récapitulatif sur une ligne en haut
- Réglages enregistrés avec le widget (partagés entre utilisateurs du document)
- **Mise en forme du panneau Grist reprise** : couleur du texte et de fond, gras, italique, souligné, barré, alignement, retour à la ligne, couleurs des choix et règles de mise en forme conditionnelle
- **Filtre** par menu déroulant sur une colonne Choix / Référence (listes comprises)
- **Vue source pour d'autres widgets** : la ligne sélectionnée peut filtrer une autre vue de la page (voir ci-dessous)

## Contenu

| Fichier      | Rôle                                                              |
|--------------|-------------------------------------------------------------------|
| `index.html` | Le widget complet en un seul fichier (DSFR chargé via CDN)        |

## Publier sur GitHub Pages

1. Créez un dépôt GitHub (par exemple `grist-widget-groupes-dsfr`) et déposez-y les fichiers
   `index.html` et `README.md` à la racine.
2. Dans le dépôt : **Settings → Pages → Build and deployment**
   - Source : *Deploy from a branch*
   - Branch : `main`, dossier `/ (root)` puis **Save**
3. Après une minute environ, le widget est disponible à l'adresse :

   ```
   https://<votre-compte>.github.io/<nom-du-depot>/index.html
   ```

## Utiliser le widget dans Grist

1. Ajoutez un widget **Personnalisé** sur la table voulue.
2. Dans la liste des widgets, choisissez **Personnalisé** (URL personnalisée) et collez l'adresse GitHub Pages ci-dessus.
3. Réglez l'**accès** sur **Accès complet au document** (*Full document access*).
   Il est nécessaire pour modifier les données et lire les types et options des colonnes.
4. Dans le panneau de droite, section **Colonnes visibles**, cliquez sur **Sélectionner tout** (ou cochez
   les colonnes à afficher) : seules les colonnes cochées sont transmises au widget.
5. Cliquez sur la roue dentée du widget pour choisir les colonnes de regroupement.

Les colonnes sont affichées dans l'ordre de la liste **Colonnes visibles** du panneau de droite : glissez-les dans ce panneau pour les réordonner
(l'ordre est relu quand vous recliquez dans le widget).

## Filtrer une autre vue avec la ligne sélectionnée

Le widget déclare à Grist la ligne sélectionnée (clic sur une cellule, flèches du clavier) :

1. Ajoutez sur la même page un second widget (tableau, carte, fiche…) sur la table à filtrer.
2. Dans le panneau de ce second widget, section **Données**, ouvrez **Sélectionner par** et choisissez la vue groupée.
3. Le second widget n'affiche alors que les enregistrements liés à la ligne sélectionnée.

Le lien fonctionne comme pour un tableau Grist classique : la table du second widget doit être la même table ou
contenir une colonne **Référence** vers la table de la vue groupée.

## Menu déroulant de filtre

Dans la roue dentée, section **Filtre**, cochez « Afficher un menu déroulant de filtre » puis choisissez une colonne
de type Choix, Liste de choix, Référence ou Liste de références. Un menu apparaît dans la barre du haut : il ne garde que
les lignes contenant la valeur choisie (pour une liste, il suffit que la valeur y figure). L'entrée « (vide) » sélectionne
les lignes sans valeur. La valeur choisie n'est pas enregistrée : elle se remet sur « tous » au rechargement.

## Mettre à jour

Remplacez `index.html` dans le dépôt. GitHub Pages peut mettre une à deux minutes à publier ;
rechargez ensuite la page Grist sans cache (Ctrl+Maj+R).

## Dépannage

Ouvrez l'adresse du widget directement dans le navigateur : vous devez voir la barre du haut et le message
« Cette page doit être ouverte comme widget personnalisé dans Grist ». Si la page est blanche ou en erreur 404,
le fichier `index.html` n'est pas publié à la racine du dépôt ou GitHub Pages n'est pas activé.

## Limites connues

- Les dates s'affichent au format français `jj/mm/aaaa`, quel que soit le format choisi dans Grist.
- Les options des colonnes de type Référence sont chargées au démarrage du widget :
  rechargez-le pour voir les éléments récemment ajoutés dans la table liée.
- Une ligne dont la colonne de regroupement est une liste (Liste de choix, Liste de références)
  apparaît dans un groupe par valeur.
- Le widget n'exploite pas « Sélectionner par » comme cible : utilisez le filtre déroulant ci-dessus.
- Mise en forme conditionnelle : les règles portant sur la ligne entière ne sont pas reprises (seules celles des colonnes le sont).
- La suppression et l'ajout de lignes se font dans Grist, pas dans le widget.
