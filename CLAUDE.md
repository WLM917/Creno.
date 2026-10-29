# Créno — contexte du projet

Lis ce fichier avant toute modification. Il résume le projet, ce qui est déjà construit,
les règles à ne jamais casser et la feuille de route.

## Le projet

**Créno** : « le bon créneau pour ton permis ». Le nom joue sur le double sens : le créneau
est une manœuvre du permis, et c'est aussi la place d'examen que cherchent les candidats.

Site web pour les jeunes qui passent le permis B, d'abord en Île-de-France (département
par défaut : Essonne, 91). Trois piliers, au même endroit :

1. **Choisir son auto-école** : classement par zone selon le taux de réussite officiel
   ET le coût réel du permis (forfait + heures en plus + frais d'examen), avec un filtre budget.
2. **Passer en candidat libre** : trouver une voiture à double commande à louer, comprendre
   RdvPermis, trouver une date d'examen plus vite (légalement).
3. **Préparer le jour de l'examen** : checklist, règles, résultat, que faire en cas d'échec.

Différence avec les concurrents : personne ne réunit le **coût réel** (pas seulement le taux
de réussite) et le **parcours candidat libre** au même endroit.

Public : 17-25 ans, souvent sur téléphone, budget serré. Ton : tutoiement, français simple,
phrases courtes, aucun jargon administratif sans explication.

## Ce qui est déjà construit (version 1)

Site statique, sans framework ni compilation : HTML + CSS + JavaScript.

```
index.html                      toutes les vues, navigation par #ancre
                                (#accueil, #classement, #candidat-libre, #examen, #methode)
assets/style.css                styles (tokens de couleur en haut, thème clair et sombre)
assets/app.js                   classement, calculateur, formulaires, checklist
assets/config.js                réglages : formEndpoint (envoi des formulaires), département par défaut
assets/favicon.svg              icône
data/index.json                 départements (code, nom, nb d'auto-écoles, moyenne), date d'import
data/departements/<code>.json   auto-écoles d'un département, chargé à la demande
                                (id = numéro d'agrément raf_numero, nom, adresse, cp, ville, site,
                                taux et presentes = réussite au 1er passage B, labels, prix éventuels)
data/prix.json                  prix déclarés par les élèves, par numéro d'agrément (vide pour l'instant)
data/loueurs.json               loueurs de voitures à double commande (2 entrées réelles à vérifier)
scripts/import_auto_ecoles.py   importe le CSV officiel et fusionne data/prix.json
scripts/build_preview.py        génère une version en un seul fichier HTML (aperçu)
```

Données réelles importées le 29 octobre 2026 depuis le fichier officiel de la Sécurité routière :
11 060 auto-écoles du permis B, dont 8 143 avec un taux publié, réussite moyenne au 1er passage
en France 60 %, en Essonne 53 %. Les auto-écoles sans taux publié sont listées à part, non classées.

Tester en local : `python3 -m http.server 8000` puis http://localhost:8000
(ouvrir index.html directement ne marche pas, à cause du chargement des JSON).

Fonctionnalités en place :
- Classement avec filtres zone, recherche ville/nom, budget max, tri, option « prix non déclaré ».
- Calculateur de coût réel d'un devis (comparaison avec le budget).
- Formulaire « Tu as passé ton permis récemment ? » (déclaration anonyme du prix réel).
- Annuaire loueurs + formulaire « Ajoute ton agence ».
- Formulaire d'alerte « Bientôt : les alertes entre candidats ».
- Checklist du jour J enregistrée dans le navigateur (localStorage, clés `creno-*`).
- Page Méthode avec la formule publique.
- Sans `formEndpoint`, les formulaires sont en mode démo : réponses gardées sur l'appareil.

## Formule du classement (déjà codée dans assets/app.js)

- Indice sur 100 = 60 % réussite + 40 % coût réel, chaque critère ramené de 0 à 100
  par rapport aux autres auto-écoles du même département.
- Réussite : taux officiel au 1er passage de l'examen pratique B, ajusté pour les petites auto-écoles :
  `taux ajusté = (taux × présentés + moyenne du département × 40) / (présentés + 40)`.
- Coût réel : `forfait + max(0, heures moyennes - heures incluses) × prix de l'heure + frais d'examen`.
- Prix non déclaré : note de prix neutre de 50 en attendant.
- Aucun prix déclaré dans tout le département : indice = réussite seule, filtre budget désactivé.
- Si la formule change, mettre à jour la page #methode en même temps.

## Règles à ne jamais casser

1. **Aucune automatisation sur RdvPermis** : pas de robot, pas de surveillance automatique,
   pas de réservation à la place du candidat, pas de revente de places. Les places sont
   nominatives et l'administration lutte contre les bots. On aide uniquement avec de
   l'information, des conseils et des alertes partagées par les candidats eux-mêmes.
2. **Le classement ne s'achète pas.** Une auto-école partenaire payante est marquée
   `"partenaire": true` et le site affiche « Partenaire payant », sans changer son indice.
   La méthode de classement reste publique (obligation de transparence des sites qui classent).
3. **Données honnêtes** : toute donnée d'exemple est marquée « Exemple » / bandeau démo.
   Ne jamais présenter des chiffres inventés comme réels. Citer la source des taux.
4. **Location de voitures double commande entre particuliers** : ne pas la lancer sans
   partenaire d'assurance. La plupart des assureurs excluent la location directe entre
   particuliers, et le sujet est surveillé (question à l'Assemblée nationale sur un agrément
   préfectoral). Commencer par référencer les loueurs professionnels.
5. Pas de nouvelle dépendance ou de framework sans raison forte : le site doit rester
   hébergeable gratuitement (GitHub Pages, Vercel, Netlify).
6. Qualité minimale : lisible sur téléphone (390 px), pas de défilement horizontal,
   thème clair et sombre, focus clavier visible, `prefers-reduced-motion` respecté.

## Design

Univers de la signalisation routière : bandeau « asphalte » sombre, panneaux d'indication
bleus avec flèches, jaune de chantier en accent rare, rangs en forme de plaque.
Polices : Overpass (titres, proche des panneaux) et Atkinson Hyperlegible (texte).
Couleurs : toujours via les variables CSS de `:root` dans assets/style.css (clair + sombre).
Garder ce style pour les nouvelles pages.

## Feuille de route (idées validées pendant la discussion)

Par ordre de priorité :

1. ~~Mettre les vrais taux de réussite~~ : fait le 29 octobre 2026. À refaire chaque trimestre
   avec `python3 scripts/import_auto_ecoles.py fichier.csv` (nouveau CSV de la carte officielle).
2. **Recevoir et exploiter les déclarations d'élèves** : brancher `formEndpoint`
   (Supabase conseillé, ou Formspree), puis agréger les déclarations par auto-école
   (médiane du forfait, des heures, du prix de l'heure) dans data/prix.json, avec le nombre
   de déclarations, puis relancer l'import. Le formulaire devra proposer de choisir l'auto-école
   dans la liste officielle (pour avoir son numéro d'agrément) au lieu d'un nom tapé à la main.
   Prévoir une modération simple contre les faux avis.
3. **Annuaire des loueurs double commande** : recherche par ville, prix de l'heure,
   boîte manuelle/auto, lien de réservation. Modèle économique : commission ou affiliation
   par réservation. Démarcher les loueurs d'Île-de-France.
4. **Trouver une date d'examen** : guide clair, centres d'examen des départements voisins,
   alertes communautaires (un candidat signale des places apparues dans un département,
   les autres sont prévenus). Jamais de bot (voir règle 1).
5. **Pages SEO par ville** : « auto-école Évry taux de réussite », « location voiture double
   commande Essonne », « permis candidat libre 91 », etc. Une page par ville importante.
6. **Comptes élèves** (plus tard) : suivre son budget, ses heures, sa checklist sur plusieurs appareils.
7. **Monétisation** : commissions loueurs, mise en avant payante clairement signalée,
   éventuellement offre premium (alertes, accompagnement candidat libre).
8. Étendre au reste de la France une fois l'Île-de-France solide.

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
- Garder la page #methode et ce fichier à jour quand quelque chose d'important change.
- Messages de commit clairs, en français.
