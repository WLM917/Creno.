-- Créno : demandes de place préparées pour les acheteurs du Pack candidat libre.
--
-- Rejouable sans risque. Installé tout seul par le robot GitHub « Brancher Supabase ».
-- L'acheteur du pack remplit « Préparer ma demande de place » dans son compte (fonction « compte », action dossier) :
-- son département, sa situation et les départements où il est prêt à aller. William lui prépare la démarche
-- de sa DDT et la liste des papiers, puis la lui envoie par e-mail. AUCUNE pièce d'identité ni aucun papier
-- n'est demandé ni gardé : c'est le candidat qui envoie lui-même sa demande à l'administration.
-- Aucun accès avec la clé publique : seules les fonctions serveur (clé service_role) lisent et écrivent.

create table if not exists public.dossiers_ddt (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete cascade,
  email text not null check (char_length(email) between 3 and 200),
  departement text not null check (departement ~ '^[0-9]{2,3}$|^2[AB]$'),
  ville text check (ville is null or char_length(ville) <= 80),
  code_ok boolean,              -- code réussi il y a moins de 5 ans et NEPH
  libre_ok boolean,             -- plus inscrit ni sous mandat d'une auto-école
  accompagnateur_ok boolean,    -- un proche bénévole peut l'accompagner
  voiture_ok boolean,           -- voiture à double commande trouvée
  appris_proches boolean,       -- a appris avec des proches, sans cours payants
  autres_departements text check (autres_departements is null or char_length(autres_departements) <= 200),
  message text check (message is null or char_length(message) <= 1000),
  traite boolean not null default false   -- William a envoyé la demande préparée
);
create index if not exists dossiers_ddt_user on public.dossiers_ddt (user_id, created_at desc);
create index if not exists dossiers_ddt_a_traiter on public.dossiers_ddt (traite, created_at);
alter table public.dossiers_ddt enable row level security;
revoke all on public.dossiers_ddt from anon, authenticated;
