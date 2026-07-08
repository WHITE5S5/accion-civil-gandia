# Directus — Fase 2

Base mínima para levantar Directus sobre el Postgres de Supabase.

## Uso local

1. Copiar `.env.example` a `.env`
2. Rellenar credenciales reales del usuario técnico `directus_admin`
3. Ejecutar:

```bash
docker compose up -d
```

4. Entrar en `http://localhost:8055`

## Colecciones editoriales

- `posts`
- `events`
- `campaigns`
- `actuaciones`
- `equipo`
- `barrios`

## Moderación

- `proposals`
- `comments`

## No exponer al rol editor

- `members`
- `payments`
- `donations`
- `consents`
- `audit_log`
- `profiles`
