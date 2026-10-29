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

  Le lien de paiement des alertes ne va pas ici : il se règle dans les secrets Supabase
  (ALERTES_LIEN_STRIPE), voir supabase/functions/alertes/index.ts.

  Sans Supabase, formEndpoint peut recevoir les réponses (Formspree, Getform...).
  Si les deux sont vides, les réponses restent sur l'appareil de la personne.
*/
window.CRENO_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  lienPaiementPack: "",
  formEndpoint: ""
};
