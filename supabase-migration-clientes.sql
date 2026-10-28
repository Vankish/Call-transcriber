-- Proyectos de clientes y tratos del CRM de Orbit (2026-10-28).
--
-- Un proyecto de tipo 'clientes' guarda llamadas comerciales: cada perfil es un
-- trato del CRM y lleva sus campos (SPIN, objetivo, próximo paso) en `crm`.
-- Sin esta migración la app sigue funcionando: solo manda estas columnas para
-- los proyectos de clientes, así que las entrevistas no las necesitan.

alter table public.projects   add column if not exists kind text not null default 'entrevistas';
alter table public.candidates add column if not exists crm  jsonb;
