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
                                  e-mail de contact, nb minimum de déclarations, code Google Search Console
templates/*.html                  contenu des pages fixes (accueil, candidat-libre, examen, methode,
                                  cout-du-permis, confidentialite), avec des {{variables}}
scripts/build_site.py             génère toutes les pages + sitemap.xml, robots.txt, 404.html, data/recherche.json
scripts/import_auto_ecoles.py     importe le CSV officiel -> data/, puis lance build_site.py
                                  (--prix-seulement : refusionne data/prix.json sans CSV)
scripts/sync_prix.py              lit les déclarations dans Supabase, calcule les médianes -> data/prix.json
supabase/migrations/*.sql         tables des formulaires + sécurité (insertion seule pour le site)
assets/style.css                  styles (tokens de couleur en haut, thème clair et sombre)
assets/app.js                     recherche de ville, filtres des pages département, calculateur,
                                  formulaires (Supabase), checklist
assets/config.js                  supabaseUrl + supabaseAnonKey (clé publique), formEndpoint de secours
assets/og.png                     image de partage (réseaux sociaux)
data/index.json                   départements (code, nom, nb, moyenne), date d'import
data/departements/<code>.json     auto-écoles d'un département (id = numéro d'agrément raf_numero)
data/prix.json                    prix déclarés par les élèves, par numéro d'agrément (vide pour l'instant)
data/loueurs.json                 loueurs de voitures à double commande (2 entrées réelles à vérifier)
data/recherche.json               index de recherche des villes (généré)

Pages générées (ne pas éditer) :
index.html                        accueil (recherche de ville, poteau de direction, top 5 du 91)
auto-ecoles/                      liste des départements
auto-ecoles/<nom>-<code>/         une page par département (102) : classement complet + filtres
auto-ecoles/<nom>-<code>/<ville>/ une page par ville d'au moins 2 auto-écoles (1 777)
candidat-libre/, cout-du-permis/, examen/, methode/, confidentialite/, 404.html, sitemap.xml, robots.txt
```

Tester en local : `python3 -m http.server 8000` puis http://localhost:8000

Données réelles importées le 29 octobre 2026 depuis le fichier officiel de la Sécurité routière :
11 060 auto-écoles du permis B, dont 8 143 avec un taux publié, réussite moyenne au 1er passage
en France 60 %, en Essonne 53 %. Les auto-écoles sans taux publié sont listées à part, non classées.
Le fichier source contient du texte mal encodé (« FORÃŠT ») : l'import le répare (demojibake).
Les noms de villes de la source n'ont pas d'accents : build_site.py en rétablit une partie (ACCENTS).

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
2. **Le classement ne s'achète pas.** Une auto-école partenaire payante est marquée
   `"partenaire": true` et le site affiche « Partenaire payant », sans changer son indice.
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
2. **Déclarations d'élèves** : code et tables prêts. Reste à créer les tables dans Supabase,
   remplir assets/config.js, puis lancer sync_prix.py régulièrement.
3. **Annuaire des loueurs double commande** : recherche par ville, prix de l'heure,
   boîte manuelle/auto, lien de réservation. Modèle économique : commission ou affiliation.
4. **Trouver une date d'examen** : guide, centres d'examen des départements voisins,
   alertes communautaires. Jamais de bot (règle 1).
5. ~~Pages par ville et par département pour Google~~ : fait (1 886 pages).
   Idées suivantes : pages « location voiture double commande <département> »,
   « permis candidat libre <département> ».
6. **Comptes élèves** (plus tard) : budget, heures, checklist sur plusieurs appareils.
7. **Monétisation** : commissions loueurs, mise en avant payante clairement signalée,
   éventuellement offre premium (alertes, accompagnement candidat libre).

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
