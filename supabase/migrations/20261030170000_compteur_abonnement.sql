-- Créno : compteur de contacts (auto-écoles et loueurs) et abonnement aux alertes.
--
-- À coller dans Supabase > SQL Editor, puis Run, APRÈS les deux fichiers précédents.
--
-- 1. Compteur : chaque clic « Contacter », « Téléphone et itinéraire », « Site web »... passe
--    par la fonction serveur « stats ». Une même personne compte une seule fois par jour et par
--    bouton (empreinte anonyme qui change chaque jour, jamais d'adresse IP en clair).
--    Le site ne peut plus écrire directement dans la table : personne ne peut gonfler les chiffres.
-- 2. Alertes : essai gratuit, puis abonnement mensuel Stripe pour continuer.

-- ---------------------------------------------------------------- compteur de contacts
alter table public.clics add column if not exists empreinte text;
alter table public.clics add column if not exists jour date not null default current_date;
alter table public.clics add column if not exists departement text
  check (departement is null or departement ~ '^[0-9]{2,3}$|^2[AB]$');
create unique index if not exists clics_une_fois_par_jour on public.clics (cible, empreinte, jour);
create index if not exists clics_jour on public.clics (jour);

drop policy if exists "le site peut compter un clic" on public.clics;
revoke insert on public.clics from anon;

-- Chiffres par pro (auto-école « ae-<agrément> » ou loueur « loueur-<nom> ») depuis une date.
-- personnes : une personne par jour ; personnes_action : sans compter la simple ouverture de la fiche.
create or replace function public.stats_pros(depuis date)
returns table (pro text, departement text, personnes bigint, personnes_action bigint, clics bigint, premier date, dernier date)
language sql stable set search_path = public as $$
  select regexp_replace(cible, '-(ouvert|carte|site|email|message|reserver)$', '') as pro,
         max(departement) as departement,
         count(distinct empreinte || '|' || jour) as personnes,
         count(distinct empreinte || '|' || jour) filter (where cible !~ '-ouvert$') as personnes_action,
         count(*) as clics,
         min(jour) as premier,
         max(jour) as dernier
  from public.clics
  where empreinte is not null and jour >= depuis
  group by 1
$$;

-- Chiffres d'un seul pro, mois par mois, avec le détail par bouton.
create or replace function public.stats_pro(p text)
returns table (mois text, personnes bigint, personnes_action bigint, ouvert bigint, carte bigint, site bigint,
               email bigint, message bigint, reserver bigint, premier date, departement text)
language sql stable set search_path = public as $$
  select to_char(jour, 'YYYY-MM') as mois,
         count(distinct empreinte || '|' || jour) as personnes,
         count(distinct empreinte || '|' || jour) filter (where cible <> p || '-ouvert') as personnes_action,
         count(*) filter (where cible = p || '-ouvert') as ouvert,
         count(*) filter (where cible = p || '-carte') as carte,
         count(*) filter (where cible = p || '-site') as site,
         count(*) filter (where cible = p || '-email') as email,
         count(*) filter (where cible = p || '-message') as message,
         count(*) filter (where cible = p || '-reserver') as reserver,
         min(jour) as premier,
         max(departement) as departement
  from public.clics
  where empreinte is not null
    and cible in (p || '-ouvert', p || '-carte', p || '-site', p || '-email', p || '-message', p || '-reserver')
  group by 1
  order by 1
$$;

-- Total des contacts envoyés (une personne, un jour, un pro), affiché sur l'espace pros.
create or replace function public.stats_total()
returns bigint
language sql stable set search_path = public as $$
  select count(distinct empreinte || '|' || jour || '|' || regexp_replace(cible, '-(ouvert|carte|site|email|message|reserver)$', ''))
  from public.clics
  where empreinte is not null and cible !~ '-ouvert$'
$$;

-- Seules les fonctions serveur (clé service_role) peuvent lire ces chiffres.
revoke execute on function public.stats_pros(date) from public, anon, authenticated;
revoke execute on function public.stats_pro(text) from public, anon, authenticated;
revoke execute on function public.stats_total() from public, anon, authenticated;
grant execute on function public.stats_pros(date) to service_role;
grant execute on function public.stats_pro(text) to service_role;
grant execute on function public.stats_total() to service_role;

-- ---------------------------------------------------------------- alertes : essai puis abonnement
-- plan : essai (gratuit, sans carte), abonne (abonnement mensuel Stripe), pass (ancien paiement unique)
-- statut : en_attente (e-mail pas encore confirmé), actif, expire (essai ou abonnement fini), desabonne
alter table public.abonnes_alertes add column if not exists plan text not null default 'essai';
alter table public.abonnes_alertes drop constraint if exists abonnes_alertes_plan_check;
alter table public.abonnes_alertes add constraint abonnes_alertes_plan_check check (plan in ('essai', 'abonne', 'pass'));
alter table public.abonnes_alertes drop constraint if exists abonnes_alertes_statut_check;
alter table public.abonnes_alertes add constraint abonnes_alertes_statut_check
  check (statut in ('en_attente', 'actif', 'expire', 'desabonne'));
alter table public.abonnes_alertes add column if not exists email_base text;   -- e-mail sans « +quelquechose » : un seul essai par personne
alter table public.abonnes_alertes add column if not exists stripe_abonnement text;
alter table public.abonnes_alertes add column if not exists rappel_envoye timestamptz;  -- rappel « ton essai se termine »
alter table public.abonnes_alertes add column if not exists fin_envoyee timestamptz;    -- e-mail « ton essai est terminé »
update public.abonnes_alertes
  set email_base = split_part(split_part(email, '@', 1), '+', 1) || '@' || split_part(email, '@', 2)
  where email_base is null;
create index if not exists abonnes_alertes_email_base on public.abonnes_alertes (email_base);
create index if not exists abonnes_alertes_fin on public.abonnes_alertes (statut, plan, expire_le);
