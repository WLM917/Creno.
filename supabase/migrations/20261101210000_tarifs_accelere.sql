-- Créno : prix annoncés par les auto-écoles et formation accélérée.
--
-- À coller dans Supabase > SQL Editor, puis Run, APRÈS les fichiers précédents.
--
-- 1. tarifs_proposes : une auto-école donne ses prix (forfait 20 h, heure en plus, présentation
--    à l'examen) et dit si elle propose une formation accélérée. Le site peut seulement ajouter
--    une ligne. Tu vérifies (lien vers sa page de tarifs, appel), puis tu passes « valide » à true :
--    scripts/sync_prix.py les met alors sur le site.
-- 2. declarations.accelere : l'élève dit s'il a suivi une formation accélérée dans son auto-école.

create table if not exists public.tarifs_proposes (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  auto_ecole_id text check (auto_ecole_id is null or auto_ecole_id ~ '^[A-Z0-9]{6,20}$'),
  auto_ecole_nom text not null check (char_length(auto_ecole_nom) between 2 and 160),
  departement text not null check (departement ~ '^[0-9]{2,3}$|^2[AB]$'),
  forfait integer check (forfait is null or forfait between 0 and 10000),
  heures_forfait integer check (heures_forfait is null or heures_forfait between 0 and 200),
  prix_heure integer check (prix_heure is null or prix_heure between 0 and 500),
  frais_examen integer check (frais_examen is null or frais_examen between 0 and 1000),
  accelere boolean not null default false,
  accelere_details text check (accelere_details is null or char_length(accelere_details) <= 200),
  lien text check (lien is null or char_length(lien) <= 300),
  contact text not null check (char_length(contact) between 4 and 200),
  valide boolean not null default false
);

alter table public.tarifs_proposes enable row level security;
drop policy if exists "le site peut proposer des tarifs" on public.tarifs_proposes;
create policy "le site peut proposer des tarifs" on public.tarifs_proposes for insert to anon with check (valide = false);
grant insert on public.tarifs_proposes to anon;

alter table public.declarations add column if not exists accelere boolean;
