# Créno

Le bon créneau pour ton permis. Site pour passer son permis B au meilleur prix :

- **Classement des auto-écoles** de toute la France, une page par département et par ville, selon le taux de réussite officiel et le **coût réel** du permis. Filtres : ville, budget, permis à 1 € par jour, label qualité, conduite accompagnée.
- **Recherche de ville** dès l'accueil.
- **Coût du permis** : calculateur du coût réel d'un devis.
- **Candidat libre** : les étapes, un annuaire de loueurs de voitures à double commande, des conseils légaux pour trouver une date d'examen plus vite.
- **Jour de l'examen** : checklist à cocher, enregistrée sur le téléphone.
- **Méthode** : la formule du classement, publique.

Site statique : les pages HTML sont générées par `scripts/build_site.py` et peuvent être hébergées gratuitement sur GitHub Pages, Vercel ou Netlify. Détails techniques et règles du projet : voir `CLAUDE.md`.

## Mettre le site en ligne avec GitHub Pages

1. Renommer le dépôt en `Creno` (sans point final) : *Settings > General > Repository name*.
2. *Settings > Pages* : *Source* = *Deploy from a branch*, branche `main`, dossier `/ (root)`, *Save*.
3. Quelques minutes après, le site est sur https://wlm917.github.io/Creno/

Si le site est publié ailleurs (Vercel, domaine perso), changer `adresse_du_site` dans `site.json`, puis relancer `python3 scripts/build_site.py`.

## Apparaître sur Google

1. Ouvrir https://search.google.com/search-console et ajouter la propriété *Préfixe de l'URL* avec l'adresse du site.
2. Choisir la vérification par *Balise HTML*, copier seulement le code `content="..."`, le coller dans `google_site_verification` de `site.json`, relancer `python3 scripts/build_site.py`, pousser.
3. Cliquer sur *Valider* dans la Search Console.
4. Menu *Sitemaps* : envoyer `sitemap.xml`.

Google met en général de quelques jours à quelques semaines pour indexer les pages.

## Brancher Supabase (formulaires)

1. Dans Supabase, *SQL Editor* : coller le contenu de `supabase/migrations/20261029120000_formulaires.sql`, *Run* (si les tables n'ont pas été créées automatiquement par l'intégration GitHub).
2. *Project Settings > API* : copier *Project URL* et la clé *anon public* dans `assets/config.js`. Ne jamais y mettre la clé *service_role*.
3. Pour intégrer les prix déclarés au classement :

   ```bash
   export SUPABASE_URL="https://xxxx.supabase.co"
   export SUPABASE_SERVICE_KEY="clé service_role (secrète)"
   python3 scripts/sync_prix.py
   ```

## Mettre à jour les taux de réussite (chaque trimestre)

1. Télécharger le CSV des auto-écoles sur https://autoecoles.securite-routiere.gouv.fr/
2. `python3 scripts/import_auto_ecoles.py chemin/vers/auto-ecoles.csv` (réimporte et régénère tout le site).

## Tester sur ton ordinateur

```bash
python3 -m http.server 8000
```

puis ouvrir http://localhost:8000
