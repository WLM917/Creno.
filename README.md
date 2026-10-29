# Créno

Le bon créneau pour ton permis. Site pour passer son permis B au meilleur prix en Île-de-France :

- **Classement des auto-écoles** par département, selon le taux de réussite officiel et le **coût réel** du permis (forfait + heures en plus + frais d'examen), avec un filtre budget.
- **Calculateur de coût réel** d'un devis d'auto-école.
- **Candidat libre** : les étapes, un annuaire de loueurs de voitures à double commande, des conseils légaux pour trouver une date d'examen plus vite.
- **Jour de l'examen** : checklist à cocher, enregistrée sur le téléphone.
- **Méthode** : la formule du classement, publique.

Le site est statique (HTML, CSS, JavaScript, sans framework ni compilation). Il peut être hébergé gratuitement sur GitHub Pages, Vercel ou Netlify.

## État actuel : version de démonstration

- `data/auto-ecoles.json` contient des **auto-écoles fictives**, marquées « Exemple » sur le site.
- Les formulaires fonctionnent en **mode démo** : les réponses restent sur l'appareil tant qu'aucune adresse d'envoi n'est configurée.

## Mettre le site en ligne

**GitHub Pages** : dans le dépôt, *Settings > Pages*, choisir la branche `main` et le dossier `/ (root)`, puis *Save*. Le site sera disponible quelques minutes après à l'adresse `https://<ton-compte>.github.io/<nom-du-dépôt>/`. Évite un point à la fin du nom du dépôt : l'adresse serait bancale.

**Vercel** : *Add New > Project*, importer le dépôt GitHub, laisser les réglages par défaut (aucune commande de build), *Deploy*.

## Tester sur ton ordinateur

Le site charge ses données avec `fetch`, il faut donc un petit serveur local (ouvrir `index.html` directement ne marche pas) :

```bash
python3 -m http.server 8000
```

puis ouvrir http://localhost:8000

## Importer les vrais taux de réussite

1. Télécharger le CSV officiel des auto-écoles depuis la carte de la Sécurité routière (https://autoecoles.securite-routiere.gouv.fr/) ou depuis data.gouv.fr : https://www.data.gouv.fr/datasets/liste-des-auto-ecoles-et-taux-de-reussite-au-permis-de-conduire
2. Vérifier que le script reconnaît bien les colonnes :

   ```bash
   python3 scripts/import_auto_ecoles.py chemin/vers/auto-ecoles.csv --apercu
   ```

   Si une colonne est mal détectée, la forcer, par exemple `--col-taux "Taux de réussite B"`.
3. Lancer l'import (Île-de-France par défaut, `--departements 91` pour l'Essonne seule) :

   ```bash
   python3 scripts/import_auto_ecoles.py chemin/vers/auto-ecoles.csv
   ```

Le fichier `data/auto-ecoles.json` est remplacé, le bandeau « démonstration » disparaît. Les prix déjà déclarés par les élèves sont conservés lors des imports suivants. La carte officielle est mise à jour chaque trimestre : relancer l'import à chaque fois.

## Recevoir les réponses des formulaires

Dans `assets/config.js`, renseigner `formEndpoint` avec une adresse qui accepte un envoi JSON (POST), par exemple un formulaire Formspree ou Getform, ou une fonction Supabase. Chaque envoi contient :

```json
{ "type": "experience | loueur | alerte", "envoye_le": "2026-10-29T12:00:00.000Z", "reponses": { "...": "..." } }
```

Les déclarations d'expérience (`type: "experience"`) servent à remplir les champs de prix de `data/auto-ecoles.json` : `forfait`, `heures_incluses`, `prix_heure`, `heures_moyennes`, `frais_examen`, `declarations` (nombre de réponses). Prendre la médiane des réponses pour chaque auto-école.

## Ajouter un loueur de voitures à double commande

Ajouter une entrée dans `data/loueurs.json` :

```json
{ "nom": "Nom de l'agence", "ville": "Ville", "dep": "91", "site": "https://..." }
```

## Règles à respecter

- Le classement ne doit jamais dépendre d'un paiement. Si une auto-école paie pour être mise en avant, ajouter `"partenaire": true` à son entrée : le site affiche alors « Partenaire payant » à côté de son nom, sans changer son indice.
- Ne jamais automatiser de réservation sur RdvPermis.

## Fichiers

```
index.html                      toutes les pages (navigation par #ancre)
assets/style.css                styles
assets/app.js                   classement, calculateur, formulaires, checklist
assets/config.js                réglages (adresse d'envoi des formulaires, département par défaut)
data/auto-ecoles.json           auto-écoles (démo pour l'instant)
data/loueurs.json               loueurs de voitures à double commande
scripts/import_auto_ecoles.py   import des taux officiels
scripts/build_preview.py        génère une version en un seul fichier (aperçu)
```
