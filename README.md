# Créno

Le bon créneau pour ton permis. Site pour passer son permis B au meilleur prix, en partant de l'Île-de-France :

- **Classement des auto-écoles** de toute la France, par département, selon le taux de réussite officiel et le **coût réel** du permis (forfait + heures en plus + frais d'examen). Filtres : ville, budget, permis à 1 € par jour, label qualité, conduite accompagnée.
- **Calculateur de coût réel** d'un devis d'auto-école.
- **Candidat libre** : les étapes, un annuaire de loueurs de voitures à double commande, des conseils légaux pour trouver une date d'examen plus vite.
- **Jour de l'examen** : checklist à cocher, enregistrée sur le téléphone.
- **Méthode** : la formule du classement, publique.

Le site est statique (HTML, CSS, JavaScript, sans framework ni compilation). Il peut être hébergé gratuitement sur GitHub Pages, Vercel ou Netlify.

## Données

- **Taux de réussite** : fichier officiel des auto-écoles de la Sécurité routière (import du 29 octobre 2026) : 11 060 auto-écoles du permis B, dont 8 143 avec un taux de réussite publié.
- **Prix** : `data/prix.json`, vide pour l'instant. Il se remplit avec les déclarations des élèves.
- Les formulaires fonctionnent en **mode local** tant qu'aucune adresse d'envoi n'est configurée : les réponses restent sur l'appareil.

## Mettre le site en ligne

**GitHub Pages** : dans le dépôt, *Settings > Pages*, choisir la branche `main` et le dossier `/ (root)`, puis *Save*. Le site sera disponible quelques minutes après à l'adresse `https://<ton-compte>.github.io/<nom-du-dépôt>/`. Évite un point à la fin du nom du dépôt : l'adresse serait bancale.

**Vercel** : *Add New > Project*, importer le dépôt GitHub, laisser les réglages par défaut (aucune commande de build), *Deploy*.

## Tester sur ton ordinateur

Le site charge ses données avec `fetch`, il faut donc un petit serveur local (ouvrir `index.html` directement ne marche pas) :

```bash
python3 -m http.server 8000
```

puis ouvrir http://localhost:8000

## Mettre à jour les taux de réussite

La carte officielle est mise à jour chaque trimestre. À chaque nouvelle version :

1. Télécharger le CSV des auto-écoles sur https://autoecoles.securite-routiere.gouv.fr/
2. Lancer :

   ```bash
   python3 scripts/import_auto_ecoles.py chemin/vers/auto-ecoles.csv
   ```

Le script réécrit `data/index.json` (départements, moyennes, date d'import) et `data/departements/<code>.json` (une liste par département, chargée seulement quand on choisit ce département). Les prix de `data/prix.json` sont fusionnés à chaque import, rien n'est perdu.

Colonnes utilisées du fichier officiel : `raf_numero` (numéro d'agrément, sert d'identifiant), `aue_raisonsociale`, `aue_adresse`, `aue_codepostal`, `aue_commune`, `dpt_id`, `aue_siteinternet`, les drapeaux `aue_*_flag`, `B_flag`, `B_nombre_1pra` (élèves présentés au 1er passage) et `B_taux_1pra` (réussite au 1er passage).

## Recevoir les réponses des formulaires

Dans `assets/config.js`, renseigner `formEndpoint` avec une adresse qui accepte un envoi JSON (POST), par exemple un formulaire Formspree ou Getform, ou une fonction Supabase. Chaque envoi contient :

```json
{ "type": "experience | loueur | alerte", "envoye_le": "2026-10-29T12:00:00.000Z", "reponses": { "...": "..." } }
```

Les déclarations d'expérience (`type: "experience"`) servent à remplir `data/prix.json`, une entrée par auto-école, avec la médiane des réponses :

```json
{ "ecoles": { "E2109100040": { "forfait": 1390, "heures_incluses": 20, "prix_heure": 52, "heures_moyennes": 31, "frais_examen": 60, "declarations": 7 } } }
```

La clé est le numéro d'agrément (`id` dans `data/departements/*.json`). Relancer ensuite l'import pour que les prix apparaissent dans le classement.

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
data/index.json                 départements, moyennes, date d'import
data/departements/*.json        auto-écoles de chaque département (taux officiels + prix)
data/prix.json                  prix déclarés par les élèves, par auto-école
data/loueurs.json               loueurs de voitures à double commande
scripts/import_auto_ecoles.py   import du fichier officiel
scripts/build_preview.py        génère une version en un seul fichier (aperçu)
```
