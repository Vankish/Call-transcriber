-- ── Migración — Entrevistadores + nombres reales + modo de resumen ──────────
-- Ejecuta TODO este archivo en el SQL Editor de Supabase
-- (supabase.com → tu proyecto → SQL Editor → New query → Run).
-- Es idempotente: se puede ejecutar más de una vez sin romper nada.

-- 1) Lista de entrevistadores por proyecto/cliente ──────────────────────────
alter table public.projects
  add column if not exists interviewers jsonb not null default '[]'::jsonb;

-- 2) Entrevistador asignado a cada llamada concreta ─────────────────────────
alter table public.interviews
  add column if not exists interviewer_name text not null default '';

-- 3) Modo de resumen (Entrevista de selección / Reunión de negocio) ─────────
--    Antes vivía solo en localStorage del navegador, sin sincronizar entre
--    equipos. Se pasa a la nube para que no dependa de qué PC lo abras.
alter table public.interviews
  add column if not exists summary_context text not null default 'entrevista';

-- ── Verificación (opcional) ──────────────────────────────────────────────────
-- select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'projects';
-- select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'interviews';
