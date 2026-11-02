# Créno — contexte du projet

Lis ce fichier avant toute modification. Il résume le projet, ce qui est déjà construit,
les règles à ne jamais casser et la feuille de route.

## Le projet

**Créno** : « le bon créneau pour ton permis ». Le nom joue sur le double sens : le créneau
est une manœuvre du permis, et c'est aussi la place d'examen que cherchent les candidats.

Site web pour les jeunes qui passent le permis B, d'abord en Île-de-France (département
par défaut : Essonne, 91), avec les données de toute la France. Trois piliers, au même endroit :

1. **Choisir son auto-école** : classement par département selon le taux de réussite officiel
   ET le coût réel du permis (forfait + heures en plus + frais d'examen), avec un filtre budget.
2. **Passer en candidat libre** : trouver une voiture à double commande à louer, comprendre
   RdvPermis, trouver une date d'examen plus vite (légalement).
3. **Préparer le jour de l'examen** : checklist, règles, résultat, que faire en cas d'échec.

Différence avec les concurrents : personne ne réunit le **coût réel** (pas seulement le taux
de réussite) et le **parcours candidat libre** au même endroit.

Public : 17-25 ans, souvent sur téléphone, budget serré. Ton : tutoiement, français simple,
phrases courtes, aucun jargon administratif sans explication.

## Architecture : site statique généré

Pas de framework, pas de serveur. Un script Python génère des pages HTML complètes, lisibles
par Google sans JavaScript ; le JavaScript ajoute seulement l'interactivité (filtres, recherche).
**Les pages HTML à la racine sont générées : ne les modifie pas à la main.** Modifie les modèles
ou le générateur, puis relance `python3 scripts/build_site.py` (Python 3.12 ou plus).

```
site.json                         réglages : adresse du site (canonical, sitemap), département par défaut,
                                  e-mail de contact, nb minimum de déclarations, code Google Search Console,
                                  prix du pack, prix_alertes (par mois) et essai_alertes_jours, alertes_payantes (false :
                                  alertes gratuites), prix_creno_pro (19,99 € par mois), vercel_analytics,
                                  editeur (mentions légales) et mediateur_consommation (CGV)
templates/*.html                  contenu des pages fixes (accueil, candidat-libre, examen, methode,
                                  cout-du-permis, confidentialite, alertes, pack, moniteurs, pro,
                                  mentions-legales, cgv, etat = pages de retour, alertes-continuer, admin, rapport),
                                  avec des {{variables}}
scripts/build_site.py             génère toutes les pages + sitemap.xml, robots.txt, 404.html, data/recherche.json,
                                  badges/<agrément>.svg (top 10 de chaque département) et data/badges.json
scripts/import_auto_ecoles.py     importe le CSV officiel -> data/, puis lance build_site.py
                                  (--prix-seulement : refusionne data/prix.json sans CSV)
scripts/sync_prix.py              lit les déclarations dans Supabase, calcule les médianes -> data/prix.json,
                                  et les tarifs vérifiés des auto-écoles (tarifs_proposes, valide = true) -> data/tarifs.json
supabase/migrations/*.sql         tables + sécurité. Toujours REJOUABLES (if not exists / drop ... if exists) :
                                  testées sur un vrai Postgres 16 local (/usr/lib/postgresql/16/bin). 1re migration : formulaires (insertion seule pour le site).
                                  2e : abonnes_alertes et signalements (aucun accès public, seulement les
                                  fonctions), pros_proposes, demandes_pros, contacts_pros, clics (insertion
                                  seule), espace de stockage privé « pack ». Dernière : creno_pro_demandes
                                  (demandes d'abonnement Créno Pro des auto-écoles, aucun accès public)
supabase/functions/alertes/       fonction serveur (Deno) : abonnement, paiement Stripe, confirmation,
                                  désabonnement, signalement de places + envoi des e-mails (Resend)
supabase/functions/pack/          fonction serveur : vérifie le paiement Stripe, renvoie un lien de 1 h vers le PDF
supabase/functions/stats/         fonction serveur : compteur des contacts envoyés aux pros, rapports des pros,
                                  tableau de bord (protégé par ADMIN_CODE), boutons « Publier / C'est fait » du tableau de bord
supabase/functions/pros/          fonction serveur : demandes d'élèves (publication, liste sans contact, réponses
                                  des pros, fermeture) et formulaires des pros (tarifs, services, messages, inscription
                                  des loueurs, demande Créno Pro), avec un e-mail à William (ADMIN_EMAIL) pour chaque envoi
.github/workflows/                brancher-supabase.yml : à chaque changement de supabase/ (ou Run workflow), crée les
                                  tables (scripts/migrer_supabase.py, par l'API Supabase avec le jeton, sans mot de
                                  passe), déploie les 4 fonctions sans JWT, copie les secrets GitHub dans
                                  Supabase, remplit config.js s'il est vide. William n'a pas d'ordinateur (iPad) :
                                  tout le branchement Supabase passe par là.
                                  mise-a-jour-prix.yml : chaque jour, lit Supabase (sync_prix.py), régénère et publie.
                                  Secrets GitHub : SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_ID, ADMIN_CODE,
                                  ADMIN_EMAIL, puis STRIPE_SECRET_KEY, RESEND_API_KEY, ALERTES_EXPEDITEUR.
                                  Résultat de chaque étape (et erreur exacte) sur la page Summary du lancement.
scripts/cle_supabase.py           trouve la clé publique / service_role dans `supabase projects api-keys -o json`
                                  (pour les workflows, jamais affichée)
assets/style.css                  styles (tokens de couleur en haut, thème clair et sombre)
assets/app.js                     recherche de ville, filtres des pages département, calculateur,
                                  formulaires (Supabase), checklist, alertes, achat et accès au pack,
                                  outil badge de l'espace pros, comptage des clics vers les partenaires
assets/config.js                  supabaseUrl + supabaseAnonKey (clé publique), lienPaiementPack (Stripe),
                                  lienCrenoPro (abonnement Stripe 19,99 €/mois des auto-écoles),
                                  lienCrenoProLoueur (celui des loueurs ; vide = lienCrenoPro), formEndpoint de secours
assets/og.png                     image de partage (réseaux sociaux)
data/index.json                   départements (code, nom, nb, moyenne), date d'import
data/departements/<code>.json     auto-écoles d'un département (id = numéro d'agrément raf_numero)
data/prix.json                    prix déclarés par les élèves, par numéro d'agrément (vide pour l'instant)
data/tarifs.json                  prix annoncés par les auto-écoles (vérifiés), par numéro d'agrément (vide pour l'instant)
data/loueurs.json                 loueurs de voitures à double commande (2 entrées réelles à vérifier) ;
                                  "formule": "gratuit" ou "partenaire" (Créno Pro) ; champs optionnels
                                  code_promo, reduction, lien_reservation
data/partenaires.json             auto-écoles abonnées à Créno Pro (par numéro d'agrément : depuis, code_promo,
                                  reduction), vide pour l'instant ; à remplir à la main après chaque paiement
data/pros.json                    annuaire des moniteurs / auto-écoles pour examen blanc (vide, à remplir
                                  à la main après vérification de chaque pro)
data/recherche.json               index de recherche des villes (généré)
.vercelignore                     fichiers du dépôt à ne pas mettre en ligne (scripts, modèles, supabase...)

Pages générées (ne pas éditer) :
index.html                        accueil (recherche de ville, poteau de direction, top 5 du 91)
auto-ecoles/                      liste des départements
auto-ecoles/<nom>-<code>/         une page par département (102) : classement complet + filtres
auto-ecoles/<nom>-<code>/<ville>/ une page par ville d'au moins 2 auto-écoles (1 777)
candidat-libre/, cout-du-permis/, examen/, methode/, confidentialite/, alertes/, pack-candidat-libre/,
moniteurs/, pro/ (3 onglets : auto-écoles, moniteurs, loueurs), pro/demandes/ (demandes d'élèves vues par les pros),
contact/ (« Nous contacter », formulaire pour élèves et pros), mentions-legales/, cgv/, 404.html, sitemap.xml, robots.txt
alertes/confirmer/, alertes/merci/, alertes/desabonner/, pack-candidat-libre/acces/ : pages de retour
                                  (noindex, hors sitemap)
alertes/continuer/                abonnement après l'essai (lien envoyé par e-mail), noindex
pro/demandes/fermer/              l'élève ferme sa demande (lien envoyé par e-mail), noindex
admin/                            tableau de bord privé de William (code ADMIN_CODE), noindex
rapport/?p=...&d=...&k=...        rapport d'un pro (lien secret à lui envoyer), noindex
```

Le PDF du Pack candidat libre n'est PAS dans le dépôt (il serait téléchargeable gratuitement) :
il est rangé dans le stockage privé Supabase « pack » sous le nom pack-candidat-libre.pdf.

Tester en local : `python3 -m http.server 8000` puis http://localhost:8000

Données réelles importées le 29 octobre 2026 depuis le fichier officiel de la Sécurité routière :
11 060 auto-écoles du permis B, dont 8 143 avec un taux publié, réussite moyenne au 1er passage
en France 60 %, en Essonne 53 %. Les auto-écoles sans taux publié sont listées à part, non classées.
Le fichier source contient du texte mal encodé (« FORÃŠT ») : l'import le répare (demojibake).
Les noms de villes de la source n'ont pas d'accents : build_site.py en rétablit une partie (ACCENTS).
Dans une partie de la source, les lettres accentuées sont remplacées par « E » (« MarEchal », « ChEteau ») :
l'import les répare (accents_perdus). Certaines auto-écoles ont mis leur e-mail dans la colonne du site :
l'import le range dans `email`. Les liens vers les annuaires concurrents (vroomvroom.fr) sont ignorés.

## Formule du classement (codée dans scripts/build_site.py, fonction classer)

- Indice sur 100 = 60 % réussite + 40 % coût réel, chaque critère ramené de 0 à 100
  par rapport aux autres auto-écoles du même département.
- Réussite : taux officiel au 1er passage de l'examen pratique B, ajusté pour les petites auto-écoles :
  `taux ajusté = (taux × présentés + moyenne du département × 40) / (présentés + 40)`.
- Coût réel : `forfait + max(0, heures moyennes - heures incluses) × prix de l'heure + frais d'examen`,
  affiché seulement à partir de `min_declarations_prix` déclarations (site.json, 3 par défaut).
- Prix non déclaré : note de prix neutre de 50 en attendant.
- Aucun prix déclaré dans tout le département : indice = réussite seule, colonne coût masquée,
  filtre budget désactivé.
- Si la formule change, mettre à jour templates/methode.html en même temps.

## Prix affichés et formation accélérée

- Le fichier officiel n'a AUCUN prix. Chaque fiche affiche « Forfait 20 h : X € · Heure en plus : Y € »
  seulement quand on les connaît. Sinon, rien n'est affiché (choix de William : pas de « prix inconnu »).
  Jamais de prix inventé (règle 3).
- Deux sources, toujours indiquées : prix annoncés par l'auto-école (data/tarifs.json, formulaire
  « Donner mes tarifs » de /pro/ -> table tarifs_proposes, publiés seulement après vérification :
  bouton « Publier » du tableau de bord (valide = true), puis la mise à jour automatique quotidienne
  (GitHub Actions) ; ou ajoutés à la main dans data/tarifs.json avec source « site », le lien et la date),
  et prix payés par les élèves (médianes de data/prix.json, à partir de min_declarations_prix).
- Seuls les prix des élèves entrent dans l'indice (coût réel). Les prix annoncés sont affichés, pas notés.
- 20 heures de conduite minimum en boîte manuelle, 13 h en boîte automatique : c'est souvent le contenu
  du forfait. Les auto-écoles doivent afficher leurs tarifs (arrêté du 19 juin 1987).
- « Formation accélérée » (étiquette, filtre, détail dans le volet) : annoncée par l'auto-école,
  ou déclarée par au moins 2 élèves (case dans le formulaire de déclaration, colonne declarations.accelere).
  Le filtre est désactivé dans un département où on ne connaît encore aucune formation accélérée.

## Formulaires et Supabase

- Tables : `declarations`, `loueurs_proposes`, `alertes` (supabase/migrations). RLS activé :
  la clé publique peut seulement insérer, jamais lire. Contrôles de valeurs dans le SQL.
- Le site envoie directement à l'API REST de Supabase si `supabaseUrl` et `supabaseAnonKey`
  sont remplis dans assets/config.js. Sinon, réponses gardées sur l'appareil (mode local).
- Le formulaire de déclaration fait choisir l'auto-école dans la liste officielle
  (datalist) pour enregistrer son numéro d'agrément (`auto_ecole_id`).
- Modération : passer `valide` à false dans Supabase pour écarter une déclaration.
- Mise à jour des prix : `SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python3 scripts/sync_prix.py`
  (la clé service_role ne doit JAMAIS être dans le dépôt).
- Nouvelles clés Supabase (`sb_publishable_...`) : app.js n'envoie alors que l'en-tête apikey,
  sans « Authorization: Bearer ».

## Services payants (alertes, pack, Créno Pro)

- **Alertes places** (/alertes/) : un candidat signale des places vues sur RdvPermis, la fonction
  `alertes` prévient par e-mail les abonnés du département (Resend). Limites anti-abus :
  3 signalements par heure et par appareil (empreinte sha256 de l'IP + sel, IP jamais gardée),
  pas plus d'un e-mail toutes les 10 minutes par abonné.
- **Pour l'instant, les alertes sont GRATUITES** (choix de William, novembre 2026 : à rendre payantes
  plus tard si le site prend de l'ampleur). site.json `alertes_payantes: false` et secret
  `ALERTES_LIEN_STRIPE` vide. Le mode payant reste codé, prêt à être rallumé :
- Formule payante : **15 jours d'essai gratuit sans carte** (double opt-in par e-mail), puis **9,99 € par mois**
  (abonnement Stripe, sans engagement). Un seul essai par personne (colonne email_base, sans « +tag »).
  La tâche quotidienne (`quotidien`, lancée par Supabase Cron avec ADMIN_CODE) envoie le rappel
  3 jours avant la fin de l'essai, arrête les essais finis (e-mail « en pause » avec lien vers
  /alertes/continuer/), et vérifie chez Stripe que chaque abonnement est toujours payé.
- « Ne plus recevoir d'alertes » (lien dans chaque e-mail) arrête les alertes ET résilie l'abonnement
  Stripe tout de suite (résiliation en un clic, obligation légale).
- Le secret `ALERTES_LIEN_STRIPE` (lien de paiement de l'abonnement mensuel) décide du mode :
  vide = lancement gratuit (les essais se prolongent tout seuls). `alertes_payantes` dans site.json
  doit être d'accord avec lui (textes du site), puis relancer build_site.py et pousser.
- **Pack candidat libre** (/pack-candidat-libre/) : lien de paiement Stripe dans config.js
  (`lienPaiementPack`), avec `client_reference_id=pack-<uuid>`. Stripe redirige vers
  /pack-candidat-libre/acces/?session_id=..., la fonction `pack` vérifie le paiement
  (statut payé, référence pack-, montant minimum) et renvoie un lien de 1 h vers le PDF.
- Les fonctions refusent un paiement inférieur au prix attendu (PACK_MONTANT_CENTIMES,
  ALERTES_MONTANT_CENTIMES) : sinon on pourrait payer avec un lien moins cher
  et récupérer le pack. Si un prix change, changer site.json, le lien Stripe ET ce secret.
- Les fonctions sont déployées sans vérification JWT (workflow brancher-supabase.yml, ou
  `supabase functions deploy --no-verify-jwt`) : le site les appelle avec la clé publique.
- Prix de l'abonnement vérifié par la fonction alertes : ALERTES_MONTANT_CENTIMES (défaut 999).
- Toute vente exige les mentions légales et les CGV remplies (site.json `editeur`,
  `mediateur_consommation`, `email_contact`) : les champs vides s'affichent « à compléter ».
  Les CGV changent toutes seules selon `alertes_payantes` (dictionnaire cgv de build_site.py).
- **Créno Pro** (19,99 € par mois, `prix_creno_pro`, FACULTATIF) : le même abonnement pour les auto-écoles
  et les loueurs, pour se faire connaître même avec un classement plus bas.
  - Auto-école : formulaire /pro/#creno-pro -> table creno_pro_demandes (fonction pros, e-mail à William,
    « À traiter » dans le tableau de bord), puis paiement Stripe si `lienCrenoPro` est rempli
    (client_reference_id=pro-ae-<id>). Après paiement, William l'ajoute dans data/partenaires.json :
    elle apparaît dans l'encadré « Mises en avant » en haut des pages de sa ville et de son département
    (fonction mises_en_avant), avec « Partenaire payant » et son code promo. **Son rang ne change pas.**
  - Loueur : radio « Créno Pro » du formulaire « Inscrire mon agence » (client_reference_id=pro-loueur-<id>),
    puis "formule": "partenaire" dans data/loueurs.json : affiché en premier, mention « Partenaire »,
    bouton Réserver, code Créno.

## Moniteurs (/moniteurs/) et espace pros (/pro/)

- Menu du haut (NAV) : Auto-écoles, Candidat libre, Alertes places, Le pack, Espace pros, Nous contacter.
- /pro/ : trois onglets (auto-écoles : présentation, « Donner mes tarifs », « Trouver mon badge » ;
  moniteurs : présentation, « Proposer mes services » ; loueurs : inscription gratuite et Créno Pro).
  L'onglet auto-écoles contient aussi la section #creno-pro (explication + formulaire).
  « Pourquoi faire confiance à Créno » est au-dessus des onglets. Sans JavaScript, les trois parties restent l'une sous l'autre.
  Un lien vers /pro/#badge, #tarifs, #proposer, #inscrire-agence... ouvre le bon onglet.
- /contact/ : « Nous écrire » pour tout le monde (élève, parent, auto-école, moniteur, loueur, autre),
  nom facultatif -> table contacts_pros via la fonction pros, e-mail à William, « Messages reçus » dans
  le tableau de bord.

- **Interdit** : faire payer un moniteur ou un pro pour accompagner un candidat libre le jour
  de l'examen (la préfecture le refuse), ou donner des cours payants hors d'une auto-école agréée
  (délit). Le jour J, l'accompagnateur est un proche bénévole : permis B depuis 5 ans, pas
  d'annulation ni d'invalidation depuis 5 ans, signature de la charte.
- Ce qu'on propose : un annuaire d'auto-écoles et de moniteurs rattachés à une auto-école agréée
  pour un **examen blanc**, des heures à l'unité, ou la **présentation à l'examen par une
  auto-école** (avec sa voiture). Demande d'élève -> table demandes_pros (consentement obligatoire).
- Un pro n'entre dans data/pros.json qu'après vérification de son agrément.
- Espace pros : présence, tarifs, réponses aux demandes et inscription des loueurs gratuits ; Créno Pro
  (19,99 €/mois) en option ; badges gratuits pour le top 10 de chaque département (lien retour vers
  Créno = référencement).
- Loueurs partenaires : `code_promo` et `lien_reservation` dans data/loueurs.json, clics comptés
  (table clics) pour prouver le trafic envoyé avant de demander une commission.
- Statistiques de visite : Vercel Web Analytics (sans cookie), à activer dans le projet Vercel.

## Demandes d'élèves (/moniteurs/#demande -> /pro/demandes/)

- L'élève publie son besoin (examen blanc, présentation à l'examen, heures, location de voiture), son
  département, sa ville, ses disponibilités, son e-mail (obligatoire) et son téléphone (facultatif,
  partagé seulement s'il coche la case). La demande apparaît sur /pro/demandes/ SANS nom ni contact.
- Un pro clique « Répondre à cet élève » : auto-école choisie dans la liste officielle (vérifiée par la
  fonction dans data/departements/<dép>.json du site), moniteur (avec son auto-école de rattachement)
  ou loueur référencé (data/loueurs.json). Son message et son contact partent à l'élève par e-mail.
- 3 réponses au plus par demande, une par pro (pro_ref ae-<agrément> ou loueur-<nom>), demande ouverte
  30 jours, l'élève peut la fermer. William reçoit un e-mail à chaque demande et à chaque réponse.
- Chaque réponse est comptée dans reponses_demandes : tableau de bord (liste des réponses, « N élèves
  contactés via les demandes » par pro) et rapport du pro (« N élèves contactés grâce aux demandes »).
- Limites anti-abus : table limites (empreinte du jour) ; 3 demandes par heure, 30 réponses par jour,
  6 formulaires par heure et par appareil.

## Loueurs : inscription gratuite, Créno Pro en option

- Inscription gratuite (formulaire « Inscrire mon agence », /pro/#inscrire-agence -> loueurs_proposes).
  William vérifie l'agence, puis l'ajoute dans data/loueurs.json avec "formule": "gratuit".
- Créno Pro (19,99 € par mois) remplace l'ancien Partenaire à 20 € : radio « Créno Pro » du même formulaire,
  paiement Stripe (lienCrenoPro), puis "formule": "partenaire" (en premier, mention « Partenaire »,
  bouton Réserver, code Créno). L'ancien Référencement à 10 € n'existe plus.
- Rémunération visée ensuite : commission par client envoyé (code promo / « je viens de Créno »).
- Mention obligatoire sous chaque liste de loueurs (MENTION_LOUEURS) : l'inscription est gratuite,
  les partenaires paient pour être mis en avant (transparence des plateformes).

## Contacter une auto-école depuis le classement

- Toucher une auto-école ouvre son volet « Contacter » (fonction panneau_contact de build_site.py) :
  « Téléphone et itinéraire » (fiche Google Maps, car la source n'a pas de téléphone), son site web
  (avec utm_source=creno pour que l'auto-école voie que la visite vient de Créno), « Leur écrire »
  (e-mail prérempli « trouvé sur Créno »), un message tout prêt à copier qui demande forfait,
  heures comprises et prix de l'heure, « dis que tu viens de Créno », et un lien pour déclarer son prix.
- Ouvrir le volet (ae-<agrément>-ouvert) et chaque bouton (-carte / -site / -email / -message) sont comptés
  par la fonction `stats` : une personne compte une fois par jour et par bouton (empreinte sha256 du jour,
  de l'IP, du navigateur et de CRENO_SEL ; IP jamais gardée), robots ignorés, 80 clics par jour et par
  appareil au plus. Le site ne peut plus écrire directement dans la table clics : personne ne peut
  gonfler les chiffres. L'ouverture automatique par un lien #ae-... n'est pas comptée.
- Loueurs : mêmes boutons (Réserver ou Voir le site, Téléphone et itinéraire, message tout prêt,
  « dis que tu viens de Créno » ou leur code promo), comptés en loueur-<nom>-<bouton>.
- **Tableau de bord** /admin/ (code ADMIN_CODE) : élèves envoyés à chaque pro (30 jours et depuis le
  début), abonnés aux alertes, revenu mensuel, et le lien du rapport de chaque pro.
- **Rapport d'un pro** /rapport/?p=<pro>&d=<dép.>&k=<clé> : la clé est un hachage de CRENO_SEL et du pro,
  donc un pro ne voit que ses chiffres. Toujours dire « ont cliqué pour vous contacter », jamais
  « se sont inscrits » : on mesure des clics, pas des inscriptions. Rapport au vouvoiement (adressé à un pro).
- Espace pros : compteur public du total des contacts, affiché seulement à partir de 50.
- Badge du top 10 (badges/<agrément>.svg) : textes mesurés avec les largeurs d'Arial (ARIAL_W) pour ne
  jamais dépasser ; nom sur deux lignes s'il est long ; mois du classement écrit dessus. Le code à coller
  se masque tout seul si l'auto-école sort du top 10 (onerror). Bouton « Télécharger l'image » (PNG).
- Rémunération visée : commission d'apporteur d'affaires (contrat écrit avec chaque pro), par élève
  inscrit ou par location, prouvée par le code Créno ou « je viens de Créno ».
- Un code promo d'auto-école partenaire (`code_promo`, `reduction`) s'affiche dans le volet s'il existe.

## Référencement (Google)

- Chaque page a un titre, une description, une URL canonique, des balises Open Graph,
  un fil d'Ariane et des données structurées (BreadcrumbList, ItemList de DrivingSchool).
  Ne jamais ajouter de note (aggregateRating) : nos indices ne sont pas des avis clients.
- Hébergement : Vercel (https://creno-tan.vercel.app), déploiement automatique à chaque push sur main.
- sitemap.xml et robots.txt utilisent `adresse_du_site` de site.json : à changer si le site
  déménage (domaine perso, Vercel...), puis relancer build_site.py.
- Google Search Console : coller le code de vérification dans `google_site_verification`
  de site.json, relancer build_site.py, pousser, puis envoyer sitemap.xml dans la console.

## Règles à ne jamais casser

1. **Aucune automatisation sur RdvPermis** : pas de robot, pas de surveillance automatique,
   pas de réservation à la place du candidat, pas de revente de places. Les places sont
   nominatives et l'administration lutte contre les bots. On aide uniquement avec de
   l'information, des conseils et des alertes partagées par les candidats eux-mêmes.
2. **Le classement ne s'achète pas.** Une auto-école Créno Pro (data/partenaires.json) est marquée
   `"partenaire": true`, apparaît dans l'encadré séparé « Mises en avant » et le site affiche
   « Partenaire payant », sans changer son indice ni son rang.
   La méthode de classement reste publique (obligation de transparence des sites qui classent).
3. **Données honnêtes** : toute donnée d'exemple est marquée comme telle. Ne jamais présenter
   des chiffres inventés comme réels. Citer la source des taux.
4. **Location de voitures double commande entre particuliers** : ne pas la lancer sans
   partenaire d'assurance. La plupart des assureurs excluent la location directe entre
   particuliers, et le sujet est surveillé (question à l'Assemblée nationale sur un agrément
   préfectoral). Commencer par référencer les loueurs professionnels.
5. Pas de nouvelle dépendance ou de framework sans raison forte : le site doit rester
   hébergeable gratuitement (GitHub Pages, Vercel, Netlify).
6. Qualité minimale : lisible sur téléphone (390 px), pas de défilement horizontal,
   thème clair et sombre, focus clavier visible, `prefers-reduced-motion` respecté.
7. Données personnelles : on ne demande pas de nom pour les déclarations. Toute nouvelle
   collecte doit être expliquée sur la page Confidentialité.
8. **Pas d'accompagnement payant le jour de l'examen** pour un candidat libre (voir Moniteurs).
9. **Aucun secret dans le dépôt** : clé service_role, clé secrète Stripe, clé Resend, jeton d'accès
   Supabase vont uniquement dans les secrets GitHub Actions (recopiés dans Supabase par
   brancher-supabase.yml) ou les secrets Supabase. Jamais dans le code ni dans une conversation.
   Vercel n'utilise aucune variable d'environnement (site statique).

## Design

Univers de la signalisation routière : bandeau « asphalte » sombre, panneaux d'indication
bleus avec flèches, panneau blanc pour la recherche de ville, poteau de direction vers les
villes sur l'accueil (ordinateur), bande bleue des plaques d'immatriculation pour les codes
département, jaune de chantier en accent rare, rangs en forme de plaque.
Polices : Overpass (titres) et Atkinson Hyperlegible (texte).
Couleurs : toujours via les variables CSS de `:root` dans assets/style.css (clair + sombre).

## Feuille de route

1. ~~Vrais taux de réussite~~ : fait. À refaire chaque trimestre avec
   `python3 scripts/import_auto_ecoles.py fichier.csv` (nouveau CSV de la carte officielle).
2. ~~Brancher Supabase~~ : fait le 2 novembre 2026 (projet bfcgtjkzgvpaafyclnmt, tables, 4 fonctions,
   secrets ADMIN_CODE / ADMIN_EMAIL / CRENO_SEL, config.js). Les prix déclarés sont repris chaque
   jour par mise-a-jour-prix.yml. Reste : déposer le PDF du pack dans le stockage « pack ».
3. **Annuaire des loueurs double commande** : inscription gratuite, Créno Pro 19,99 €/mois codé (formulaire + Stripe).
   Reste : recherche par ville, boîte manuelle/auto dans la fiche.
4. **Trouver une date d'examen** : guide fait, alertes communautaires codées et déployées (fonction `alertes`).
   Reste : brancher Resend (RESEND_API_KEY) et un domaine, sans quoi aucun e-mail ne part
   (les formulaires sont quand même enregistrés). Jamais de bot (règle 1).
5. ~~Pages par ville et par département pour Google~~ : fait (1 892 pages).
   Idées suivantes : pages « location voiture double commande <département> »,
   « permis candidat libre <département> ».
6. **Comptes élèves** (plus tard) : budget, heures, checklist sur plusieurs appareils.
7. **Monétisation** : pack candidat libre (14,99 €) et Créno Pro (19,99 €/mois, auto-écoles et loueurs)
   codés, à brancher sur Stripe. Alertes gratuites pour l'instant (mode 9,99 €/mois prêt).
   Ensuite : commissions par élève (auto-écoles) et par client (loueurs), contrat d'apporteur d'affaires.

## Concurrents à connaître

- VroomVroom : comparateur d'auto-écoles depuis 2013, taux de réussite + avis vérifiés.
- DevisPermis : devis comparés d'auto-écoles.
- Ornikar, En Voiture Simone, Stych : auto-écoles en ligne.
- Klaxo : présenté comme le « Doctolib des auto-écoles ».
- Loueurs double commande : Free Conduite (franchise depuis 2009), Success Permis,
  Permis Malin (Bourg-la-Reine), Just Permis (Serris).

## Faits vérifiés (octobre 2026) à réutiliser dans les textes

- RdvPermis, site officiel des candidats : https://candidat.permisdeconduire.gouv.fr
- Candidat libre : il réserve lui-même sa place avec son numéro NEPH, loue une voiture
  à double commande assurée pour l'examen, et vient avec un proche titulaire du permis
  depuis au moins 5 ans, déclaré en ligne.
- Annulation plus de 6 jours avant : nouvelle réservation possible tout de suite ;
  moins de 6 jours avant : 30 jours d'attente ; absence sans motif sérieux : 40 jours.
- Résultat disponible sous 48 h (hors week-ends et jours fériés) sur RdvPermis.
- Après un échec, le délai pour repasser dépend de la note obtenue.
- Très peu d'auto-écoles affichent leurs taux (environ 4,5 % pour l'épreuve pratique
  selon une enquête de l'UFC-Que Choisir).
- La carte officielle des auto-écoles de la Sécurité routière est mise à jour chaque trimestre.

Avant d'écrire une règle ou un chiffre administratif nouveau, vérifie-le sur une source
officielle (service-public.fr, securite-routiere.gouv.fr, RdvPermis).

## Méthode de travail

- Faire des changements petits et testés, puis vérifier le rendu sur téléphone et ordinateur.
- Après toute modification d'un modèle, du générateur ou des données : relancer build_site.py
  et pousser les pages générées avec le reste.
- Garder templates/methode.html et ce fichier à jour quand quelque chose d'important change.
- Messages de commit clairs, en français.
