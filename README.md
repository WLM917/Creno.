# Créno

Le bon créneau pour ton permis. Site pour passer son permis B au meilleur prix :

- **Classement des auto-écoles** de toute la France, une page par département et par ville, selon le taux de réussite officiel et le **coût réel** du permis. Filtres : ville, budget, permis à 1 € par jour, label qualité, conduite accompagnée.
- **Recherche de ville** dès l'accueil.
- **Coût du permis** : calculateur du coût réel d'un devis.
- **Candidat libre** : les étapes, un annuaire de loueurs de voitures à double commande, des conseils légaux pour trouver une date d'examen plus vite.
- **Jour de l'examen** : checklist à cocher, enregistrée sur le téléphone.
- **Alertes places** : les candidats signalent les places vues sur RdvPermis, les abonnés du département reçoivent un e-mail. Gratuit pour l'instant (un mode payant, 15 jours gratuits puis 9,99 € par mois, est prêt pour plus tard). Aucun robot.
- **Pack candidat libre** (14,99 €) : guide PDF du dossier au jour J, programme en 12 séances, examen blanc noté.
- **Moniteurs** : examen blanc ou présentation à l'examen par une auto-école agréée, dans les règles.
- **Espace pros** : gratuit pour les auto-écoles, les moniteurs et les loueurs (inscription, tarifs, réponses aux demandes d'élèves), badges du top 10, compteur des élèves envoyés et rapport personnel pour chaque pro. En option, **Créno Pro** (19,99 € par mois) pour se faire connaître : encadré « Mises en avant » pour les auto-écoles (le rang ne change pas), première place et mention « Partenaire » pour les loueurs.
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

## Brancher les alertes, le pack et le compteur

1. **SQL** : dans *SQL Editor*, lancer dans l'ordre tous les fichiers de `supabase/migrations/` (du plus ancien au plus récent).
2. **PDF** : *Storage* > espace `pack` (privé) > déposer `pack-candidat-libre.pdf`. Ne jamais le mettre dans le dépôt.
3. **Stripe** : créer les *Payment Links* :
   - Pack candidat libre, 14,99 €, paiement unique ; après paiement, rediriger vers
     `https://creno-tan.vercel.app/pack-candidat-libre/acces/?session_id={CHECKOUT_SESSION_ID}`
   - Créno Pro, 19,99 € **par mois** (produit récurrent), le même pour les auto-écoles et les loueurs.
   - Plus tard seulement, si les alertes deviennent payantes : Alertes, 9,99 € par mois ; rediriger vers
     `https://creno-tan.vercel.app/alertes/merci/?session_id={CHECKOUT_SESSION_ID}`
4. **Resend** : créer un compte, vérifier un domaine (ex. creno.fr), créer une clé API.
5. **Fonctions** : déployer `alertes`, `pack`, `stats` et `pros`, sans vérification JWT :

   ```bash
   supabase functions deploy alertes --no-verify-jwt
   supabase functions deploy pack --no-verify-jwt
   supabase functions deploy stats --no-verify-jwt
   supabase functions deploy pros --no-verify-jwt
   ```

6. **Secrets** (*Edge Functions > Secrets*) : `SITE_URL`, `RESEND_API_KEY`, `ALERTES_EXPEDITEUR`,
   `STRIPE_SECRET_KEY`, `CRENO_SEL` (phrase au hasard), `ADMIN_CODE` (ton code du tableau de bord),
   `ADMIN_EMAIL` (ton e-mail : tu y reçois chaque demande d'élève, chaque réponse de pro et chaque formulaire),
   `PACK_MONTANT_CENTIMES=1499`, `ALERTES_MONTANT_CENTIMES=999`, `ALERTES_ESSAI_JOURS=15`,
   et `ALERTES_LIEN_STRIPE` : **laisse-le vide tant que les alertes sont gratuites** (remplis-le avec le
   lien de l'abonnement seulement le jour où elles deviennent payantes).
7. **Tâche quotidienne des alertes** (utile seulement quand les alertes sont payantes : rappels de fin d'essai, renouvellements) : *Integrations > Cron*,
   créer une tâche chaque jour à 9 h qui appelle la fonction `alertes` en POST avec le corps
   `{"action":"quotidien","code":"TON_ADMIN_CODE"}`. Ou en SQL (extensions pg_cron et pg_net activées) :

   ```sql
   select cron.schedule('alertes-quotidien', '7 8 * * *', $$
     select net.http_post(
       url := 'https://TON-PROJET.supabase.co/functions/v1/alertes',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{"action": "quotidien", "code": "TON_ADMIN_CODE"}'::jsonb)
   $$);
   ```

8. **Site** : dans `assets/config.js`, remplir `supabaseUrl`, `supabaseAnonKey`, `lienPaiementPack` et
   `lienCrenoPro` (lien de l'abonnement Créno Pro à 19,99 €/mois).
   Dans `site.json`, remplir `email_contact`, `editeur` et `mediateur_consommation` ; `alertes_payantes`
   (false aujourd'hui) doit être d'accord avec `ALERTES_LIEN_STRIPE`. Relancer `python3 scripts/build_site.py`, pousser.
9. **Vercel** : onglet *Analytics* > activer Web Analytics.

## Mise à jour automatique des prix (GitHub)

Sur GitHub : *Settings > Secrets and variables > Actions > New repository secret*, ajouter
`SUPABASE_URL` et `SUPABASE_SERVICE_KEY` (clé service_role ou secret, jamais dans le code).
Chaque jour, `.github/workflows/mise-a-jour-prix.yml` lit Supabase, régénère les pages et publie.
Pour le lancer tout de suite : onglet *Actions* > « Mettre à jour les prix » > *Run workflow*.
Si Vercel refuse de déployer les commits du robot (dépôt privé), mettre dans le workflow l'e-mail
de ton compte GitHub à la place de celui de github-actions[bot].

## Afficher les prix des auto-écoles

- Une auto-école donne ses tarifs depuis l'espace pros (« Donner mes tarifs ») : tu reçois un e-mail et
  ils apparaissent dans ton tableau de bord. Vérifie-les (sa page de tarifs, un appel), clique « Publier » :
  ils s'affichent sur sa fiche à la prochaine mise à jour automatique (chaque jour, ou tout de suite avec
  *Run workflow*).
- Tu peux aussi recopier à la main les tarifs publiés sur le site d'une auto-école dans `data/tarifs.json`
  (avec `source: "site"`, le lien de la page et la date), relancer `python3 scripts/build_site.py` et pousser.
- Les prix payés par les élèves s'affichent à partir de 3 déclarations pour la même auto-école.

## Activer Créno Pro pour un pro

- **Auto-école** : sa demande arrive par e-mail et dans « À traiter » du tableau de bord. Une fois le
  paiement vu dans Stripe, ajoute-la dans `data/partenaires.json`, par exemple :

  ```json
  "auto_ecoles": {
    "E1109108230": { "depuis": "2026-11-15", "code_promo": "CRENO10", "reduction": "frais de dossier offerts" }
  }
  ```

  (`code_promo` et `reduction` sont facultatifs), relance `python3 scripts/build_site.py` et pousse.
  Elle apparaît dans « Mises en avant » en haut des pages de sa ville et de son département, avec
  « Partenaire payant ». Son rang ne change pas. Quand elle arrête de payer, retire-la.
- **Loueur** : dans `data/loueurs.json`, passe sa `formule` de `"gratuit"` à `"partenaire"`, relance le build et pousse.

## Tableau de bord et rapports des pros

- Ouvrir `https://creno-tan.vercel.app/admin/` et taper son `ADMIN_CODE` : élèves envoyés à chaque
  auto-école et loueur, abonnés aux alertes, revenu mensuel.
- Pour chaque pro, « Copier le lien » donne son rapport personnel (il ne voit que ses chiffres) :
  c'est ce lien qu'on lui envoie pour montrer ce que Créno lui apporte.

## Mettre à jour les taux de réussite (chaque trimestre)

1. Télécharger le CSV des auto-écoles sur https://autoecoles.securite-routiere.gouv.fr/
2. `python3 scripts/import_auto_ecoles.py chemin/vers/auto-ecoles.csv` (réimporte et régénère tout le site).

## Tester sur ton ordinateur

```bash
python3 -m http.server 8000
```

puis ouvrir http://localhost:8000
