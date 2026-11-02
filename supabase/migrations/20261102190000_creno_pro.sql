-- Créno : demandes d'abonnement Créno Pro des auto-écoles (19,99 € par mois, mise en avant).
-- À coller dans Supabase > SQL Editor, puis Run, APRÈS les fichiers précédents.
-- Les loueurs passent par loueurs_proposes (formule « partenaire » = Créno Pro, « referencement » = gratuit).

create table if not exists public.creno_pro_demandes (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  auto_ecole_id text check (auto_ecole_id is null or auto_ecole_id ~ '^[A-Z0-9]{6,20}$'),
  auto_ecole_nom text not null check (char_length(auto_ecole_nom) between 2 and 160),
  departement text check (departement is null or departement ~ '^[0-9]{2,3}$|^2[AB]$'),
  contact text not null check (char_length(contact) between 4 and 200),
  email text check (email is null or char_length(email) <= 200),
  message text check (message is null or char_length(message) <= 600),
  traite boolean not null default false
);
alter table public.creno_pro_demandes enable row level security;
-- Aucune politique : seule la fonction « pros » y écrit, seul le tableau de bord la lit.
