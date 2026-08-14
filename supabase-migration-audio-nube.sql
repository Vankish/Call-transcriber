-- ── Migración — Audios en la nube (sincronización entre PCs) ────────────────
-- Ejecuta TODO este archivo en el SQL Editor de Supabase
-- (supabase.com → tu proyecto → SQL Editor → New query → Run).
-- Es idempotente: se puede ejecutar más de una vez sin romper nada.
--
-- CONTEXTO: hasta ahora los .mp3 se guardaban SOLO en Documents\CallTranscriber
-- del PC que grabó. En el otro equipo la entrevista aparecía en la lista, pero sin
-- audio no se podía reproducir ni re-transcribir. Esto sube el audio a Supabase
-- Storage para que viaje con el resto de los datos.
--
-- OJO CON EL ESPACIO: el plan gratis de Supabase son 1 GB. Cada entrevista sube
-- dos archivos (la mezcla + la pista del interlocutor), unos 60-70 MB en total
-- para una hora de grabación. Da para unas 15 entrevistas. El VÍDEO no se sube:
-- pesa ~300 MB por entrevista y llenaría el GB con dos.

-- 1) Nombre del archivo de la pista de sistema ───────────────────────────────
--    Antes vivía solo en el localStorage del navegador, así que el otro PC no
--    sabía ni cómo se llamaba el archivo. Sin esto no hay separación de hablantes
--    al re-transcribir fuera del equipo que grabó.
alter table public.interviews
  add column if not exists system_audio_file_name text not null default '';

-- 2) Marca de "este audio ya está subido" ────────────────────────────────────
--    Evita tener que preguntarle al Storage por cada entrevista al abrir la app.
alter table public.interviews
  add column if not exists audio_uploaded boolean not null default false;

-- 3) Bucket privado para las grabaciones ─────────────────────────────────────
--    OJO AL LÍMITE POR ARCHIVO: en el plan gratuito Supabase no acepta archivos
--    de más de 50 MB. Un .mp3 de una hora ronda los 32 MB, así que entra; una
--    entrevista de dos horas NO subirá y la app avisará con un error. Si pasa,
--    hay que subir el plan o bajar la calidad del audio en Ajustes → Grabación.
insert into storage.buckets (id, name, public, file_size_limit)
values ('recordings', 'recordings', false, 52428800)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

-- 4) Permisos: cada usuario solo toca su propia carpeta ──────────────────────
--    Las rutas son {user_id}/{interview_id}/{nombre-del-archivo}, así que basta
--    con comparar la primera carpeta contra el usuario autenticado.
drop policy if exists "recordings_select_own" on storage.objects;
create policy "recordings_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "recordings_insert_own" on storage.objects;
create policy "recordings_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "recordings_update_own" on storage.objects;
create policy "recordings_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "recordings_delete_own" on storage.objects;
create policy "recordings_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'recordings' and (storage.foldername(name))[1] = auth.uid()::text);

-- ── Verificación (opcional) ──────────────────────────────────────────────────
-- select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'interviews'
--     and column_name in ('system_audio_file_name', 'audio_uploaded');
-- select id, public from storage.buckets where id = 'recordings';
