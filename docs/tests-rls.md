# Tests RLS — Fase 2

Comprobaciones mínimas después de ejecutar `001_init.sql`, `002_members_inbox.sql` y `003_public_api_grants.sql`.

## 1. Contenido público sí responde

Con la `anon key`:

```bash
curl "$SUPABASE_URL/rest/v1/posts?select=slug,estado" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```

Esperado: solo filas `publicado`.

## 2. Tablas sensibles devuelven 0 filas

```bash
curl "$SUPABASE_URL/rest/v1/members?select=*" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```

```bash
curl "$SUPABASE_URL/rest/v1/donations?select=*" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```

```bash
curl "$SUPABASE_URL/rest/v1/consents?select=*" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```

Esperado en los tres casos: `[]`.

## 3. Proposals borrador no son públicas

```bash
curl "$SUPABASE_URL/rest/v1/proposals?select=id,estado" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```

Esperado: solo `publicada`, `aprobada` o `en_estudio`.

## 4. Vista pública de votos sí funciona

```bash
curl "$SUPABASE_URL/rest/v1/proposal_vote_counts?select=*" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```

Esperado: recuentos agregados, nunca filas individuales de `votes`.

## 5. Frontend Fase 2

Comprobar:

```bash
curl "https://TU-SITE/api/posts?lang=es"
curl "https://TU-SITE/api/events?lang=es"
curl "https://TU-SITE/api/campaigns?lang=es"
curl "https://TU-SITE/api/actuaciones?lang=es"
curl "https://TU-SITE/api/home?lang=es"
```

Esperado: `200` y JSON con `ok: true`.
