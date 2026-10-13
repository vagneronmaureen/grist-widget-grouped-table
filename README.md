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
- La suppression et l'ajout de lignes se font dans Grist, pas dans le widget.
