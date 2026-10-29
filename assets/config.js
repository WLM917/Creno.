/*
  Réglages de Créno côté navigateur.

  Supabase : colle ici l'adresse du projet (Project URL) et la clé publique
  (anon public key), visibles dans Supabase > Project Settings > API.
  N'y mets JAMAIS la clé service_role : elle est secrète.
  La clé publique est faite pour être visible : les tables sont protégées
  (le site peut seulement ajouter des réponses, jamais les lire).
  Voir supabase/migrations/ pour la création des tables.

  Sans Supabase, formEndpoint peut recevoir les réponses (Formspree, Getform...).
  Si les deux sont vides, les réponses restent sur l'appareil de la personne.
*/
window.CRENO_CONFIG = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  formEndpoint: ""
};
