-- Créno : chiffres du tableau de bord (page privée /admin/).
--
-- Rejouable sans risque (create or replace). Installé tout seul par le robot GitHub « Brancher Supabase ».
--
-- Rappel : la table clics garde au plus une ligne par personne, par jour et par bouton
-- (index unique cible + empreinte + jour). Compter des lignes, c'est donc compter des personnes-jours.
-- Boutons : ouvert (volet « Contacter » ouvert), carte (Téléphone et itinéraire), site, email,
-- message (message tout prêt copié), reserver (loueurs).

-- Détail par pro et par bouton, depuis une date.
create or replace function public.stats_boutons(depuis date)
returns table (pro text, departement text, ouvert bigint, carte bigint, site bigint, email bigint,
               message bigint, reserver bigint, personnes bigint, personnes_action bigint, dernier date)
language sql stable set search_path = public as $$
  select regexp_replace(cible, '-(ouvert|carte|site|email|message|reserver)$', '') as pro,
         max(departement) as departement,
         count(*) filter (where cible ~ '-ouvert$') as ouvert,
         count(*) filter (where cible ~ '-carte$') as carte,
         count(*) filter (where cible ~ '-site$') as site,
         count(*) filter (where cible ~ '-email$') as email,
         count(*) filter (where cible ~ '-message$') as message,
         count(*) filter (where cible ~ '-reserver$') as reserver,
         count(distinct empreinte || '|' || jour) as personnes,
         count(distinct empreinte || '|' || jour) filter (where cible !~ '-ouvert$') as personnes_action,
         max(jour) as dernier
  from public.clics
  where empreinte is not null and jour >= depuis
  group by 1
$$;

-- Jour par jour, depuis une date : fiches ouvertes et élèves envoyés (une personne, un jour, un pro).
create or replace function public.stats_jours(depuis date)
returns table (jour date, fiches bigint, eleves bigint)
language sql stable set search_path = public as $$
  select jour,
         count(*) filter (where cible ~ '-ouvert$') as fiches,
         count(distinct empreinte || '|' || regexp_replace(cible, '-(ouvert|carte|site|email|message|reserver)$', ''))
           filter (where cible !~ '-ouvert$') as eleves
  from public.clics
  where empreinte is not null and jour >= depuis
  group by jour
  order by jour
$$;

-- Seules les fonctions serveur (clé service_role) peuvent lire ces chiffres.
revoke execute on function public.stats_boutons(date) from public, anon, authenticated;
revoke execute on function public.stats_jours(date) from public, anon, authenticated;
grant execute on function public.stats_boutons(date) to service_role;
grant execute on function public.stats_jours(date) to service_role;
