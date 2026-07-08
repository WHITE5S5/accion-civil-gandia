-- Fase 2: exposición controlada del esquema public a la Data API.
-- RLS sigue siendo la capa que decide qué filas puede ver cada rol.

grant usage on schema public to anon, authenticated;

grant select on all tables in schema public to anon, authenticated;
grant select on all sequences in schema public to anon, authenticated;

grant insert, update on table public.profiles to authenticated;
grant select, insert, update, delete on table public.votes to authenticated;
grant select, insert on table public.proposals to authenticated;
grant select, insert on table public.comments to authenticated;

alter view if exists public.proposal_vote_counts set (security_invoker = true);
grant select on public.proposal_vote_counts to anon, authenticated;
