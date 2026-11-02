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

## Brancher le site (une seule fois)

Tout se fait depuis un navigateur, même sur iPad. Pas de terminal.

**Vercel n'a besoin d'aucune variable d'environnement** : le site est fait de pages déjà prêtes,
Vercel les affiche telles quelles. Seul réglage utile : onglet *Analytics* > activer Web Analytics.

### 1. Deux codes à prendre dans Supabase

- **Jeton d'accès** : supabase.com > ton avatar > *Account preferences* > *Access Tokens* >
  *Generate new token*. Copie-le tout de suite (il n'est montré qu'une fois).
- **Identifiant du projet** : *Project Settings > General > Project ID*
  (l'adresse `https://xxxx.supabase.co` marche aussi).

### 2. Les coller dans GitHub

Dépôt sur github.com > *Settings > Secrets and variables > Actions > New repository secret*.
Un secret = un nom (à recopier exactement) + sa valeur :

| Nom | Valeur |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | le jeton d'accès |
| `SUPABASE_PROJECT_ID` | l'identifiant du projet |
| `ADMIN_CODE` | un code que tu inventes pour ouvrir ton tableau de bord /admin/ |
| `ADMIN_EMAIL` | ton e-mail (tu y reçois chaque demande d'élève, réponse de pro et formulaire) |
| `CRENO_SEL` | facultatif : une phrase au hasard (sert à rendre anonymes les compteurs) |

Plus tard, quand les comptes existent : `STRIPE_SECRET_KEY` (Stripe > Développeurs > Clés API),
`RESEND_API_KEY` (resend.com > API Keys) et `ALERTES_EXPEDITEUR` (ex. `Créno <alertes@creno.fr>`,
une fois un domaine vérifié dans Resend). Ne mets **pas** `ALERTES_LIEN_STRIPE` tant que les alertes sont gratuites.

Les clés secrètes ne vont jamais dans le code, ni dans une conversation : seulement ici.

### 3. Lancer l'installation

Onglet *Actions* du dépôt > « Brancher Supabase » > *Run workflow*. Ça crée les tables (par l'API
Supabase, sans mot de passe), déploie les 4 fonctions (alertes, pack, stats, pros), copie les secrets
dans Supabase et remplit `assets/config.js`. La page *Summary* du lancement affiche chaque étape
(✅ ou ❌ avec l'erreur exacte) : en cas de croix rouge, envoyer une capture de cette page à Claude.
À relancer après chaque nouveau secret ajouté.

`.github/workflows/mise-a-jour-prix.yml` utilise les mêmes secrets : chaque jour, il lit les prix dans
Supabase, régénère les pages et publie (*Actions* > « Mettre à jour les prix » > *Run workflow* pour
le lancer tout de suite).

### 4. Le PDF du pack

Supabase > *Storage* > espace `pack` > *Upload file* : `pack-candidat-libre.pdf`. Jamais dans le dépôt.

### 5. Stripe (pour vendre)

Créer deux *Payment Links* et envoyer les liens à Claude (ils vont dans `assets/config.js`) :
- Pack candidat libre, 14,99 €, paiement unique ; après paiement, rediriger vers
  `https://creno-tan.vercel.app/pack-candidat-libre/acces/?session_id={CHECKOUT_SESSION_ID}`
- Créno Pro, 19,99 € **par mois** (produit récurrent), le même pour les auto-écoles et les loueurs.

Plus tard seulement, si les alertes deviennent payantes : un lien Alertes à 9,99 € par mois (redirection
vers `https://creno-tan.vercel.app/alertes/merci/?session_id={CHECKOUT_SESSION_ID}`), dans le secret
`ALERTES_LIEN_STRIPE`, `alertes_payantes: true` dans `site.json`, et une tâche quotidienne
(*Integrations > Cron* : POST vers la fonction `alertes` avec `{"action":"quotidien","code":"TON_ADMIN_CODE"}`).

### 6. Avant de vendre

Remplir dans `site.json` : `email_contact`, `editeur` (statut, par exemple micro-entreprise, et SIRET)
et `mediateur_consommation`. Puis relancer `python3 scripts/build_site.py` et pousser.

### Sans GitHub Actions (avec un ordinateur)

```bash
supabase link --project-ref TON_PROJET && supabase db push
supabase functions deploy --project-ref TON_PROJET --no-verify-jwt
SUPABASE_URL=https://TON_PROJET.supabase.co SUPABASE_SERVICE_KEY=... python3 scripts/sync_prix.py
```

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
