# Créno

Le bon créneau pour ton permis. Site pour passer son permis B au meilleur prix :

- **Classement des auto-écoles** de toute la France, une page par département et par ville, selon le taux de réussite officiel et le **coût réel** du permis. Filtres : ville, budget, permis à 1 € par jour, label qualité, conduite accompagnée.
- **Recherche de ville** dès l'accueil.
- **Coût du permis** : calculateur du coût réel d'un devis.
- **Candidat libre** : les étapes, un annuaire de loueurs de voitures à double commande, des conseils légaux pour trouver une date d'examen plus vite.
- **Jour de l'examen** : checklist à cocher, enregistrée sur le téléphone.
- **Alertes places** : les candidats signalent les places vues sur RdvPermis, les abonnés du département reçoivent un e-mail (gratuit au lancement, puis pass de 2,99 € pour 30 jours). Aucun robot.
- **Pack candidat libre** (14,99 €) : guide PDF du dossier au jour J, programme en 12 séances, examen blanc noté.
- **Moniteurs** : examen blanc ou présentation à l'examen par une auto-école agréée, dans les règles.
- **Espace pros** : offres pour auto-écoles, moniteurs et loueurs, badges du top 10.
- **Méthode** : la formule du classement, publique. **Mentions légales** et **conditions de vente**.

Site statique : les pages HTML sont générées par `scripts/build_site.py` et peuvent être hébergées gratuitement sur GitHub Pages, Vercel ou Netlify. Détails techniques et règles du projet : voir `CLAUDE.md`.

## Hébergement

Le site est en ligne sur https://creno-tan.vercel.app, hébergé par Vercel (projet relié au dépôt GitHub). Chaque push sur `main` met le site à jour automatiquement, sans réglage de build.

S'il déménage (domaine perso comme creno.fr), changer `adresse_du_site` dans `site.json`, puis relancer `python3 scripts/build_site.py` et pousser.

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

## Brancher les alertes et le pack (paiements)

1. **SQL** : dans *SQL Editor*, lancer aussi `supabase/migrations/20261029160000_alertes_pack_pros.sql`.
2. **PDF** : *Storage* > espace `pack` (privé) > déposer `pack-candidat-libre.pdf`. Ne jamais le mettre dans le dépôt.
3. **Stripe** : créer deux *Payment Links* :
   - Pack candidat libre, 14,99 € ; après paiement, rediriger vers
     `https://creno-tan.vercel.app/pack-candidat-libre/acces/?session_id={CHECKOUT_SESSION_ID}`
   - Pass alertes 30 jours, 2,99 € (paiement unique) ; rediriger vers
     `https://creno-tan.vercel.app/alertes/merci/?session_id={CHECKOUT_SESSION_ID}`
4. **Resend** : créer un compte, vérifier un domaine (ex. creno.fr), créer une clé API.
5. **Fonctions** : déployer avec la CLI Supabase, sans vérification JWT :

   ```bash
   supabase functions deploy alertes --no-verify-jwt
   supabase functions deploy pack --no-verify-jwt
   ```

6. **Secrets** (*Edge Functions > Secrets*) : `SITE_URL`, `RESEND_API_KEY`, `ALERTES_EXPEDITEUR`,
   `STRIPE_SECRET_KEY`, `ALERTES_SEL` (phrase au hasard), `PACK_MONTANT_CENTIMES=1499`,
   `ALERTES_MONTANT_CENTIMES=299`, et `ALERTES_LIEN_STRIPE` seulement quand les alertes deviennent payantes.
7. **Site** : dans `assets/config.js`, remplir `supabaseUrl`, `supabaseAnonKey` et `lienPaiementPack`.
   Dans `site.json`, remplir `email_contact`, `editeur` et `mediateur_consommation`, et mettre
   `alertes_payantes` à `true` en même temps que `ALERTES_LIEN_STRIPE`. Relancer `python3 scripts/build_site.py`, pousser.
8. **Vercel** : onglet *Analytics* > activer Web Analytics.

## Mettre à jour les taux de réussite (chaque trimestre)

1. Télécharger le CSV des auto-écoles sur https://autoecoles.securite-routiere.gouv.fr/
2. `python3 scripts/import_auto_ecoles.py chemin/vers/auto-ecoles.csv` (réimporte et régénère tout le site).

## Tester sur ton ordinateur

```bash
python3 -m http.server 8000
```

puis ouvrir http://localhost:8000
