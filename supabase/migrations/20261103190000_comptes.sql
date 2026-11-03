-- Créno : comptes des élèves et des pros (connexion par e-mail et mot de passe, Supabase Auth).
--
-- Rejouable sans risque. Installé tout seul par le robot GitHub « Brancher Supabase ».
-- Aucune de ces tables n'est lisible avec la clé publique : tout passe par la fonction serveur « compte »,
-- qui vérifie le jeton de connexion de la personne. Tout ce qui est privé est rattaché au compte (user_id),
-- jamais à une simple adresse e-mail : tant que les e-mails ne sont pas confirmés, une adresse ne prouve rien.

-- ---------------------------------------------------------------- profil de chaque compte
create table if not exists public.profils (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  type text not null default 'eleve' check (type in ('eleve', 'pro')),
  pro_type text check (pro_type is null or pro_type in ('auto-ecole', 'moniteur', 'loueur')),
  prenom text check (prenom is null or char_length(prenom) <= 60),
  telephone text check (telephone is null or telephone ~ '^[0-9 +().-]{6,20}$'),
  departement text check (departement is null or departement ~ '^[0-9]{2,3}$|^2[AB]$')
);
alter table public.profils enable row level security;

-- ---------------------------------------------------------------- un compte pro relié à une auto-école ou un loueur
-- William vérifie chaque lien (statut verifie) avant que le pro voie ses chiffres.
create table if not exists public.liens_pros (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid not null references auth.users (id) on delete cascade,
  pro_ref text not null check (pro_ref ~ '^(ae-[A-Z0-9_]{6,24}|loueur-[a-z0-9-]{2,60}|moniteur-[a-z0-9-]{2,60})$'),
  nom text not null check (char_length(nom) between 2 and 160),
  departement text check (departement is null or departement ~ '^[0-9]{2,3}$|^2[AB]$'),
  statut text not null default 'en_attente' check (statut in ('en_attente', 'verifie', 'refuse')),
  unique (user_id, pro_ref)
);
create index if not exists liens_pros_statut on public.liens_pros (statut, created_at desc);
alter table public.liens_pros enable row level security;

-- ---------------------------------------------------------------- achats du pack (pour le retrouver depuis son compte)
-- ref = client_reference_id du paiement Stripe : « pack-<identifiant du compte> ».
create table if not exists public.achats_pack (
  session_id text primary key check (char_length(session_id) between 8 and 200),
  created_at timestamptz not null default now(),
  ref text not null check (char_length(ref) <= 80),
  montant integer not null default 0
);
create index if not exists achats_pack_ref on public.achats_pack (ref);
alter table public.achats_pack enable row level security;

-- ---------------------------------------------------------------- ce que la personne a envoyé, rattaché à son compte
alter table public.demandes_pros add column if not exists user_id uuid references auth.users (id) on delete set null;
alter table public.abonnes_alertes add column if not exists user_id uuid references auth.users (id) on delete set null;
alter table public.pros_proposes add column if not exists user_id uuid references auth.users (id) on delete set null;
alter table public.loueurs_proposes add column if not exists user_id uuid references auth.users (id) on delete set null;
alter table public.creno_pro_demandes add column if not exists user_id uuid references auth.users (id) on delete set null;
alter table public.tarifs_proposes add column if not exists user_id uuid references auth.users (id) on delete set null;
alter table public.reponses_demandes add column if not exists user_id uuid references auth.users (id) on delete set null;
create index if not exists demandes_pros_user on public.demandes_pros (user_id);
create index if not exists abonnes_alertes_user on public.abonnes_alertes (user_id);

-- Personne d'autre que les fonctions serveur (clé service_role) ne lit ces tables.
revoke all on public.profils, public.liens_pros, public.achats_pack from anon, authenticated;
