-- Créno : alertes partagées, pack candidat libre, rubrique pros (moniteurs, loueurs, auto-écoles).
--
-- Si ces tables n'apparaissent pas toutes seules dans Supabase, copie ce fichier
-- dans Supabase > SQL Editor, puis clique sur Run (après le fichier 20261029120000).
--
-- Sécurité :
-- - abonnes_alertes et signalements ne sont accessibles QUE par les fonctions serveur
--   (supabase/functions/alertes), qui utilisent la clé service_role. Aucun accès avec la clé publique.
-- - Les autres tables acceptent seulement des ajouts depuis le site (clé publique), jamais la lecture.

-- ---------------------------------------------------------------- alertes partagées
create table if not exists public.abonnes_alertes (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 200),
  departement text not null check (departement ~ '^[0-9]{2,3}$|^2[AB]$'),
  token uuid not null unique default gen_random_uuid(),
  -- en_attente : e-mail ou paiement pas encore confirmé ; actif ; desabonne
  statut text not null default 'en_attente' check (statut in ('en_attente', 'actif', 'desabonne')),
  expire_le timestamptz,
  stripe_session text unique,
  dernier_envoi timestamptz
);
create index if not exists abonnes_alertes_dep on public.abonnes_alertes (departement, statut);

create table if not exists public.signalements (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  departement text not null check (departement ~ '^[0-9]{2,3}$|^2[AB]$'),
  centre text not null check (char_length(centre) between 2 and 120),
  creneau text check (creneau is null or char_length(creneau) <= 120),
  details text check (details is null or char_length(details) <= 300),
  empreinte text not null,          -- empreinte anonyme de l'appareil (anti-abus), jamais l'adresse IP en clair
  nb_prevenus integer not null default 0,
  valide boolean not null default true
);
create index if not exists signalements_dep on public.signalements (departement, created_at desc);
create index if not exists signalements_empreinte on public.signalements (empreinte, created_at desc);

alter table public.abonnes_alertes enable row level security;
alter table public.signalements enable row level security;
-- Aucune politique : seules les fonctions serveur (service_role) y accèdent.

-- ---------------------------------------------------------------- pros : moniteurs et auto-écoles
-- Un pro (auto-école agréée ou moniteur rattaché à une auto-école agréée) propose ses services.
create table if not exists public.pros_proposes (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  type text not null check (type in ('auto-ecole', 'moniteur', 'loueur')),
  nom text not null check (char_length(nom) between 2 and 120),
  etablissement text check (etablissement is null or char_length(etablissement) <= 160),
  numero_agrement text check (numero_agrement is null or char_length(numero_agrement) <= 40),
  ville text not null check (char_length(ville) between 2 and 80),
  departement text not null check (departement ~ '^[0-9]{2,3}$|^2[AB]$'),
  offres text check (offres is null or char_length(offres) <= 400),
  prix text check (prix is null or char_length(prix) <= 200),
  contact text not null check (char_length(contact) between 4 and 200),
  verifie boolean not null default false
);

-- Un élève demande à être contacté par un pro (contact transmis au pro choisi).
create table if not exists public.demandes_pros (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  departement text not null check (departement ~ '^[0-9]{2,3}$|^2[AB]$'),
  besoin text not null check (besoin in ('heures', 'examen-blanc', 'presentation-examen', 'location-voiture')),
  ville text check (ville is null or char_length(ville) <= 80),
  disponibilites text check (disponibilites is null or char_length(disponibilites) <= 300),
  contact text not null check (char_length(contact) between 4 and 200),
  consentement boolean not null check (consentement = true),
  traitee boolean not null default false
);

-- Un professionnel veut en savoir plus sur les offres Créno.
create table if not exists public.contacts_pros (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  type text not null check (type in ('auto-ecole', 'moniteur', 'loueur', 'autre')),
  nom text not null check (char_length(nom) between 2 and 160),
  ville text check (ville is null or char_length(ville) <= 80),
  contact text not null check (char_length(contact) between 4 and 200),
  message text check (message is null or char_length(message) <= 1000),
  auto_ecole_id text check (auto_ecole_id is null or auto_ecole_id ~ '^[A-Z0-9]{6,20}$')
);

-- Clics vers les loueurs partenaires (preuve du nombre de clients envoyés). Aucune donnée personnelle.
create table if not exists public.clics (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  cible text not null check (char_length(cible) between 2 and 80),
  page text check (page is null or char_length(page) <= 200)
);

alter table public.pros_proposes enable row level security;
alter table public.demandes_pros enable row level security;
alter table public.contacts_pros enable row level security;
alter table public.clics enable row level security;

drop policy if exists "le site peut proposer un pro" on public.pros_proposes;
create policy "le site peut proposer un pro" on public.pros_proposes for insert to anon with check (verifie = false);
drop policy if exists "le site peut envoyer une demande" on public.demandes_pros;
create policy "le site peut envoyer une demande" on public.demandes_pros for insert to anon with check (traitee = false);
drop policy if exists "le site peut envoyer un contact pro" on public.contacts_pros;
create policy "le site peut envoyer un contact pro" on public.contacts_pros for insert to anon with check (true);
drop policy if exists "le site peut compter un clic" on public.clics;
create policy "le site peut compter un clic" on public.clics for insert to anon with check (true);

grant insert on public.pros_proposes, public.demandes_pros, public.contacts_pros, public.clics to anon;

-- ---------------------------------------------------------------- pack candidat libre
-- Le PDF du pack est rangé dans un espace de stockage PRIVÉ. La fonction « pack » donne
-- un lien temporaire seulement après vérification du paiement Stripe.
insert into storage.buckets (id, name, public)
values ('pack', 'pack', false)
on conflict (id) do nothing;
