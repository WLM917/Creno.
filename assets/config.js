/*
  Réglages de Créno côté navigateur.

  supabaseUrl / supabaseAnonKey : l'adresse du projet (Project URL) et la clé publique
  (anon public ou publishable), visibles dans Supabase > Project Settings > API.
  N'y mets JAMAIS la clé service_role ou secret : elle est secrète.
  La clé publique est faite pour être visible : les tables sont protégées
  (le site peut seulement ajouter des réponses, jamais les lire).

  lienPaiementPack : le lien de paiement Stripe du Pack candidat libre (https://buy.stripe.com/...).
  Dans Stripe, règle « Après le paiement » sur « Rediriger vers ton site » avec l'adresse :
  https://creno-tan.vercel.app/pack-candidat-libre/acces/?session_id={CHECKOUT_SESSION_ID}

  lienCrenoPro : le lien de paiement Stripe de l'abonnement Créno Pro des auto-écoles (19,99 € par mois).
  lienCrenoProLoueur : celui des loueurs (vide : les loueurs utilisent aussi lienCrenoPro).
  Vide : la demande est enregistrée et tu recontactes le pro pour l'activer.

  lienGererAbonnement : le lien du portail client Stripe (Stripe > Paramètres > Billing > Portail client,
  « Lien de connexion », https://billing.stripe.com/p/login/...). Les pros abonnés à Créno Pro y retrouvent
  leurs factures, changent leur carte ou arrêtent l'abonnement, depuis « Gérer mon compte ».
  Vide : le compte leur propose de t'écrire pour arrêter.

  Le lien de paiement des alertes ne va pas ici : il se règle dans les secrets Supabase
  (ALERTES_LIEN_STRIPE), voir supabase/functions/alertes/index.ts.

  Sans Supabase, formEndpoint peut recevoir les réponses (Formspree, Getform...).
  Si les deux sont vides, les réponses restent sur l'appareil de la personne.
*/
window.CRENO_CONFIG = {
  supabaseUrl: "https://bfcgtjkzgvpaafyclnmt.supabase.co",
  supabaseAnonKey: "sb_publishable_X-hWXCFGAVrRr4OOpxePKg_TGyyULKd",
  lienPaiementPack: "https://buy.stripe.com/bJefZg23Gb3YbTNbLP4ko02",
  lienCrenoPro: "https://buy.stripe.com/9B614m0ZCb3Yf5ZcPT4ko01",
  lienCrenoProLoueur: "https://buy.stripe.com/cNifZgfUw1tof5Z8zD4ko00",
  lienGererAbonnement: "https://billing.stripe.com/p/login/cNifZgfUw1tof5Z8zD4ko00",
  formEndpoint: ""
};
