-- Créno : tables qui reçoivent les formulaires du site.
-- Sécurité : le site (clé publique "anon") peut seulement AJOUTER des lignes.
-- Personne ne peut les lire avec la clé publique. Pour les lire, utilise le
-- tableau de bord Supabase ou la clé service_role (secrète) dans scripts/sync_prix.py.
--
-- Si ces tables n'apparaissent pas toutes seules dans Supabase, copie ce fichier
-- dans Supabase > SQL Editor, puis clique sur Run.

create table if not exists public.declarations (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  auto_ecole_id text check (auto_ecole_id is null or auto_ecole_id ~ '^[A-Z0-9]{6,20}$'),
  auto_ecole_nom text not null check (char_length(auto_ecole_nom) between 2 and 160),
  departement text not null check (departement ~ '^[0-9]{2,3}$|^2[AB]$'),
  forfait integer not null check (forfait between 0 and 10000),
  heures_incluses integer not null check (heures_incluses between 0 and 200),
  prix_heure integer not null check (prix_heure between 0 and 500),
  heures_total integer not null check (heures_total between 0 and 300),
  frais_examen integer check (frais_examen is null or frais_examen between 0 and 1000),
  resultat text not null check (resultat in ('1er', '2e', '3e+', 'pas-encore')),
  valide boolean not null default true
);

create table if not exists public.loueurs_proposes (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  nom text not null check (char_length(nom) between 2 and 120),
  ville text not null check (char_length(ville) between 2 and 80),
  contact text not null check (char_length(contact) between 4 and 200),
  prix_heure integer check (prix_heure is null or prix_heure between 0 and 500),
  verifie boolean not null default false
);

create table if not exists public.alertes (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 200),
  departement text not null check (departement ~ '^[0-9]{2,3}$|^2[AB]$')
);

alter table public.declarations enable row level security;
alter table public.loueurs_proposes enable row level security;
alter table public.alertes enable row level security;

drop policy if exists "le site peut ajouter une declaration" on public.declarations;
create policy "le site peut ajouter une declaration" on public.declarations
  for insert to anon with check (valide = true);

drop policy if exists "le site peut proposer un loueur" on public.loueurs_proposes;
create policy "le site peut proposer un loueur" on public.loueurs_proposes
  for insert to anon with check (verifie = false);

drop policy if exists "le site peut ajouter une alerte" on public.alertes;
create policy "le site peut ajouter une alerte" on public.alertes
  for insert to anon with check (true);

-- Aucune politique "select" pour anon : les réponses ne sont pas lisibles depuis le site.
grant insert on public.declarations, public.loueurs_proposes, public.alertes to anon;
