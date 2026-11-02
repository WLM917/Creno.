-- Créno : demandes d'élèves visibles par les pros, réponses des pros, inscription payante des loueurs.
--
-- À coller dans Supabase > SQL Editor, puis Run, APRÈS les fichiers précédents.
--
-- 1. demandes_pros : la demande d'un élève apparaît sur la page « Demandes d'élèves » des pros,
--    SANS son nom ni son contact. Les pros répondent via Créno : leur message part à l'élève par e-mail.
-- 2. reponses_demandes : chaque réponse d'un pro est gardée. C'est la preuve des élèves que Créno
--    apporte à chaque auto-école, moniteur ou loueur (tableau de bord et rapport de chaque pro).
-- 3. loueurs_proposes : l'agence choisit sa formule (référencement ou partenaire).
-- Tout passe par la fonction serveur « pros » : la clé publique n'a aucun accès à ces nouvelles données.

-- ---------------------------------------------------------------- demandes des élèves
alter table public.demandes_pros add column if not exists email text
  check (email is null or (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 200));
alter table public.demandes_pros add column if not exists telephone text check (telephone is null or char_length(telephone) <= 30);
alter table public.demandes_pros add column if not exists partage_tel boolean not null default false;
alter table public.demandes_pros add column if not exists token uuid not null default gen_random_uuid();
alter table public.demandes_pros add column if not exists statut text not null default 'ouverte';
alter table public.demandes_pros drop constraint if exists demandes_pros_statut_check;
alter table public.demandes_pros add constraint demandes_pros_statut_check check (statut in ('ouverte', 'fermee'));
alter table public.demandes_pros add column if not exists nb_reponses integer not null default 0;
create unique index if not exists demandes_pros_token on public.demandes_pros (token);
create index if not exists demandes_pros_ouvertes on public.demandes_pros (statut, departement, created_at desc);

-- Les demandes passent maintenant par la fonction « pros » (e-mail de confirmation, limites anti-abus).
drop policy if exists "le site peut envoyer une demande" on public.demandes_pros;
revoke insert on public.demandes_pros from anon;

-- ---------------------------------------------------------------- réponses des pros
create table if not exists public.reponses_demandes (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  demande_id bigint not null references public.demandes_pros (id) on delete cascade,
  pro_type text not null check (pro_type in ('auto-ecole', 'moniteur', 'loueur')),
  pro_ref text not null check (char_length(pro_ref) between 4 and 80),   -- ae-<agrément> ou loueur-<nom>
  pro_nom text not null check (char_length(pro_nom) between 2 and 200),
  departement_pro text,
  contact text not null check (char_length(contact) between 4 and 200),
  message text check (message is null or char_length(message) <= 600),
  empreinte text not null
);
create index if not exists reponses_demandes_pro on public.reponses_demandes (pro_ref, created_at desc);
create index if not exists reponses_demandes_demande on public.reponses_demandes (demande_id);
alter table public.reponses_demandes enable row level security;
-- Aucune politique : seules les fonctions serveur y accèdent.

-- Limites anti-abus des formulaires (empreinte anonyme du jour, jamais l'adresse IP).
create table if not exists public.limites (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  empreinte text not null,
  action text not null
);
create index if not exists limites_empreinte on public.limites (empreinte, action, created_at desc);
alter table public.limites enable row level security;

-- ---------------------------------------------------------------- inscription des loueurs
alter table public.loueurs_proposes add column if not exists departement text
  check (departement is null or departement ~ '^[0-9]{2,3}$|^2[AB]$');
alter table public.loueurs_proposes add column if not exists formule text
  check (formule is null or formule in ('referencement', 'partenaire'));
alter table public.loueurs_proposes add column if not exists adresse text check (adresse is null or char_length(adresse) <= 200);
alter table public.loueurs_proposes add column if not exists site text check (site is null or char_length(site) <= 300);
alter table public.loueurs_proposes add column if not exists email text check (email is null or char_length(email) <= 200);
alter table public.loueurs_proposes add column if not exists boite text check (boite is null or boite in ('manuelle', 'automatique', 'les-deux'));

-- ---------------------------------------------------------------- suivi dans le tableau de bord
alter table public.contacts_pros add column if not exists traite boolean not null default false;
