/*
  Réglages de Permiscope.

  Les formulaires (déclaration d'expérience, ajout d'un loueur, alertes de dates)
  envoient leurs réponses à l'adresse indiquée ci-dessous, au format JSON (POST).
  Exemples de services gratuits qui fournissent une adresse : Formspree, Getform,
  ou une table Supabase. Voir le README.

  Tant que l'adresse est vide, le site fonctionne en mode démo : les réponses
  restent sur l'appareil de la personne et ne sont envoyées nulle part.
*/
window.PERMISCOPE_CONFIG = {
  formEndpoint: "",
  departementParDefaut: "91"
};
