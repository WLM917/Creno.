-- Créno : la page « Nous contacter » est ouverte à tous (élèves, parents, pros).
-- À coller dans Supabase > SQL Editor, puis Run, APRÈS les fichiers précédents.

alter table public.contacts_pros drop constraint if exists contacts_pros_type_check;
alter table public.contacts_pros add constraint contacts_pros_type_check
  check (type in ('eleve', 'auto-ecole', 'moniteur', 'loueur', 'autre'));
-- Le nom devient facultatif (un élève peut écrire sans donner son nom).
alter table public.contacts_pros alter column nom drop not null;
