-- ── Migración de lanzamiento — Call Transcriber ─────────────────────────────
-- Ejecuta TODO este archivo en el SQL Editor de Supabase
-- (supabase.com → tu proyecto → SQL Editor → New query → Run).
-- Es idempotente: se puede ejecutar más de una vez sin romper nada.

-- 1) Consentimiento del candidato (RGPD) ────────────────────────────────────
--    Necesario para que la app pueda guardar quién dio consentimiento y cuándo.
alter table public.candidates
  add column if not exists consent_given boolean not null default false;
alter table public.candidates
  add column if not exists consent_at timestamptz;

-- 2) Purga de la Groq API key huérfana ───────────────────────────────────────
--    La key ya NO se sincroniza a la nube (vive solo en el config.json local).
--    Esta columna pudo quedar con claves en texto plano de versiones antiguas.

--    2a) Vaciar cualquier valor residual primero (por si quieres conservar la
--        columna temporalmente). Descomenta si NO vas a borrar la columna aún:
-- update public.profiles set groq_api_key = '' where groq_api_key <> '';

--    2b) Eliminar la columna por completo (recomendado):
alter table public.profiles
  drop column if exists groq_api_key;

-- ── Verificación (opcional) ──────────────────────────────────────────────────
-- select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'profiles';
-- select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'candidates';
