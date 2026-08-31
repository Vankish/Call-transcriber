-- ── Migración — Compartir un proyecto con un compañero ──────────────────────
-- Ejecuta TODO este archivo en el SQL Editor de Supabase
-- (supabase.com → tu proyecto → SQL Editor → New query → Run).
-- Es idempotente: se puede ejecutar más de una vez sin romper nada.
--
-- QUÉ RESUELVE: hasta ahora cada proyecto (cada "carpeta" de la app) era de una
-- sola persona. Si dos reclutadores llevaban el mismo proceso, el segundo no veía
-- nada: ni los candidatos, ni las entrevistas, ni los audios. Esto añade la pieza
-- que faltaba: el dueño mete el CORREO de un compañero y ese compañero pasa a ver
-- y a TRABAJAR en esa carpeta.
--
-- QUÉ PUEDE HACER EL COMPAÑERO INVITADO:
--   ✔ ver el proyecto y sus candidatos y entrevistas
--   ✔ crear candidatos y entrevistas dentro de esa carpeta
--   ✔ editar transcripciones, transcribir y guardar resúmenes
--   ✔ escuchar y volver a subir los audios de esas entrevistas
-- QUÉ **NO** PUEDE HACER:
--   ✘ borrar la carpeta ni renombrarla / cerrarla
--   ✘ compartirla con terceros
--   ✘ quitarle el acceso a nadie (ni a sí mismo desde aquí)
-- Todo eso queda reservado al dueño, que es quien creó el proyecto.
--
-- SI NO EJECUTAS ESTE ARCHIVO: la app podrá enseñar el botón de compartir, pero
-- Supabase seguirá rechazando cada intento (no existe ni la tabla donde apuntar
-- el permiso), y el compañero seguirá sin ver absolutamente nada.
--
-- IMPORTANTE: este archivo REESCRIBE las políticas de seguridad de projects,
-- candidates e interviews que venían de `supabase-schema.sql`. Es la fuente de
-- verdad a partir de ahora; si algún día reinstalas el esquema desde cero,
-- vuelve a pasar este archivo después.

-- 1) Tabla de "a quién le he dado acceso a qué" ──────────────────────────────
--    Una fila = "el proyecto X está compartido con la persona Y". Nada más.
--    - project_id / owner_id / shared_with_id llevan `on delete cascade`: si se
--      borra el proyecto o se da de baja cualquiera de las dos personas, la fila
--      desaparece sola y no quedan permisos huérfanos apuntando a la nada.
--    - shared_with_email se guarda solo para poder PINTAR el correo en la lista
--      de "compartido con" sin tener que ir a buscar el perfil cada vez. Es una
--      copia informativa: quien manda de verdad es shared_with_id.
--    - unique (project_id, shared_with_id): impide invitar dos veces a la misma
--      persona al mismo proyecto (y hace que la app pueda reintentar sin miedo).
create table if not exists public.project_shares (
  id                uuid primary key default gen_random_uuid(),
  project_id        text references public.projects(id) on delete cascade not null,
  owner_id          uuid references auth.users on delete cascade not null,
  shared_with_id    uuid references auth.users on delete cascade not null,
  shared_with_email text not null default '',
  created_at        timestamptz not null default now(),
  unique (project_id, shared_with_id)
);

--    Índices: el primero para la pregunta que hace la app al arrancar ("¿qué me
--    han compartido a mí?"), el segundo para la pantalla del proyecto ("¿con
--    quién está compartida esta carpeta?"). Sin ellos todo funciona igual, solo
--    que Postgres recorrería la tabla entera en cada consulta.
create index if not exists project_shares_shared_with_idx on public.project_shares (shared_with_id);
create index if not exists project_shares_project_idx     on public.project_shares (project_id);

-- 2) La función que responde "¿puedo entrar en esta carpeta?" ────────────────
--    Devuelve true si el usuario que está usando la app es el dueño del proyecto
--    O si alguien se lo ha compartido. Todas las políticas de abajo se apoyan en
--    ella, así que la regla vive en UN solo sitio.
--
--    ⚠️ EL `security definer` NO ES OPCIONAL. Significa "esta función se ejecuta
--    con los permisos de quien la creó, saltándose las políticas de seguridad de
--    las tablas que consulta". Si no lo pusiéramos, pasaría esto: alguien lee
--    `projects` → Postgres aplica la política de projects → la política llama a
--    esta función → la función lee `projects` → se vuelve a aplicar la política…
--    y así hasta que Postgres corta con un error de "recursión infinita en la
--    política" y la app deja de cargar. Con `security definer` la función lee las
--    tablas directamente y el bucle no llega a empezar.
--
--    `stable` le dice a Postgres que dentro de una misma consulta el resultado no
--    cambia, así la puede llamar una vez en lugar de una por fila (va más rápido).
--    `set search_path = public` evita que nadie pueda colar tablas falsas con el
--    mismo nombre para engañar a una función con permisos elevados.
create or replace function public.puede_ver_proyecto(p_project_id text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.projects p
     where p.id = p_project_id
       and p.user_id = auth.uid()
  ) or exists (
    select 1 from public.project_shares s
     where s.project_id = p_project_id
       and s.shared_with_id = auth.uid()
  );
$$;

-- 3) Buscar a un compañero por su correo ─────────────────────────────────────
--    La app no puede leer la tabla de perfiles de otras personas (y así debe
--    seguir siendo). Esta función es la única puerta: le pasas un correo
--    COMPLETO y, si esa persona tiene cuenta, te devuelve su id y su nombre para
--    poder invitarla. Si no existe, no devuelve nada y la app dice "no hemos
--    encontrado a nadie con ese correo".
--
--    ⚠️ POR QUÉ LA COMPARACIÓN ES EXACTA Y NUNCA `like` / `ilike`:
--    si aceptara búsquedas parciales, cualquier usuario podría escribir "a",
--    luego "b", luego "ma", y con paciencia ir sacando la LISTA ENTERA de correos
--    de todos los usuarios de la app. Eso es una fuga de datos personales (y en
--    la UE, una brecha de RGPD). Con igualdad exacta hay que saber ya el correo
--    completo de antemano, que es justo el caso real: te lo ha dado tu compañero.
--    El `lower(trim(...))` en los dos lados es solo para que dé igual escribirlo
--    con mayúsculas o con un espacio pegado al copiar y pegar.
--    `id <> auth.uid()` evita el caso tonto de compartirte una carpeta contigo.
--    `limit 1` porque un correo identifica a una sola persona.
create or replace function public.buscar_usuario_por_correo(p_email text)
returns table (id uuid, name text, email text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.name, p.email
    from public.profiles p
   where lower(trim(p.email)) = lower(trim(p_email))
     and p.id <> auth.uid()
   limit 1;
$$;

--    Quién puede llamarla: SOLO usuarios con la sesión iniciada. Se le retira el
--    permiso a todo el mundo (incluido `anon`, el visitante sin cuenta) y se le
--    concede únicamente a `authenticated`. Sin esto, alguien con la clave pública
--    de la app podría comprobar desde fuera si un correo tiene cuenta o no.
revoke all on function public.buscar_usuario_por_correo(text) from public, anon;
grant execute on function public.buscar_usuario_por_correo(text) to authenticated;

-- 4) Permisos sobre la propia tabla de compartidos ───────────────────────────
--    Sin RLS, cualquiera podría leer con quién comparte todo el mundo sus
--    procesos de selección, o peor: darse acceso a sí mismo a la carpeta ajena.
alter table public.project_shares enable row level security;

drop policy if exists "shares_select" on public.project_shares;
drop policy if exists "shares_insert" on public.project_shares;
drop policy if exists "shares_delete" on public.project_shares;

--    LEER: las dos partes implicadas. El dueño necesita ver a quién se lo ha dado
--    (para poder retirarlo) y el invitado necesita ver que se lo han dado (es así
--    como la app sabe qué carpetas ajenas debe enseñarle).
create policy "shares_select" on public.project_shares
  for select
  using (auth.uid() = owner_id or auth.uid() = shared_with_id);

--    INVITAR: solo el dueño real. Se comprueban DOS cosas a la vez, y las dos
--    hacen falta: (a) que quien escribe la fila se ponga a sí mismo como owner_id
--    y (b) que ese proyecto sea de verdad suyo en la tabla projects. Sin (b),
--    alguien podría escribir una fila diciendo "soy el dueño de la carpeta de
--    otro" y colarse. Esto es lo que impide que un invitado reparta accesos.
create policy "shares_insert" on public.project_shares
  for insert
  with check (
    auth.uid() = owner_id
    and exists (
      select 1 from public.projects p
       where p.id = project_id
         and p.user_id = auth.uid()
    )
  );

--    RETIRAR EL ACCESO: solo el dueño. Un invitado no puede echar a otro invitado.
create policy "shares_delete" on public.project_shares
  for delete
  using (auth.uid() = owner_id);

--    No hay política de UPDATE a propósito: una fila de esta tabla no tiene nada
--    editable. Para cambiar algo se borra el acceso y se vuelve a añadir.

-- 5) Reescritura de los permisos de projects / candidates / interviews ───────
--    Las políticas originales eran una sola por tabla, del tipo `for all using
--    (auth.uid() = user_id)`: "esto es mío o no existe". A partir de aquí hay que
--    distinguir OPERACIÓN POR OPERACIÓN, porque el invitado puede hacer unas
--    cosas sí y otras no. Por eso se parten en select / insert / update / delete.
--
--    Se borran primero las antiguas (`drop policy if exists`) para que este
--    archivo se pueda ejecutar las veces que haga falta sin dar error de
--    "la política ya existe".

-- 5.a) PROYECTOS ─────────────────────────────────────────────────────────────
drop policy if exists "own projects"    on public.projects;
drop policy if exists "projects_select" on public.projects;
drop policy if exists "projects_insert" on public.projects;
drop policy if exists "projects_update" on public.projects;
drop policy if exists "projects_delete" on public.projects;

--    VER: el dueño, o alguien a quien se lo hayan compartido.
create policy "projects_select" on public.projects
  for select
  using (auth.uid() = user_id or public.puede_ver_proyecto(id));

--    CREAR: cada uno crea sus propias carpetas, siempre a su nombre.
create policy "projects_insert" on public.projects
  for insert
  with check (auth.uid() = user_id);

--    EDITAR (nombre, empresa, estado, criterios de evaluación, entrevistadores):
--    SOLO EL DUEÑO.
--    ⚠️ AQUÍ ESTÁ LA DIFERENCIA IMPORTANTE DE TODO EL ARCHIVO. La carpeta es el
--    "contenedor" del proceso: renombrarla, cerrarla o cambiar los criterios de
--    evaluación afecta a TODOS los que están dentro y a cómo se resume cada
--    entrevista. Eso es una decisión del responsable del proceso, no de quien ha
--    entrado a echar una mano. En cambio el contenido (candidatos y entrevistas)
--    sí es trabajo del día a día, y ahí el compañero manda igual que el dueño:
--    por eso más abajo el update de candidates/interviews sí está compartido.
create policy "projects_update" on public.projects
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

--    BORRAR: solo el dueño. Borrar el proyecto se lleva por delante candidatos,
--    entrevistas y transcripciones (por el `on delete cascade`), así que no puede
--    estar en manos de un invitado.
create policy "projects_delete" on public.projects
  for delete
  using (auth.uid() = user_id);

-- 5.b) CANDIDATOS ────────────────────────────────────────────────────────────
drop policy if exists "own candidates"    on public.candidates;
drop policy if exists "candidates_select" on public.candidates;
drop policy if exists "candidates_insert" on public.candidates;
drop policy if exists "candidates_update" on public.candidates;
drop policy if exists "candidates_delete" on public.candidates;

--    VER: los míos, más los de cualquier carpeta compartida conmigo.
create policy "candidates_select" on public.candidates
  for select
  using (auth.uid() = user_id or public.puede_ver_proyecto(project_id));

--    CREAR: la fila se guarda siempre a nombre de quien la crea (`user_id`), y
--    además la carpeta destino tiene que ser mía o estar compartida conmigo. Así
--    el compañero puede dar de alta candidatos nuevos en el proceso compartido,
--    pero nadie puede colar filas en carpetas a las que no tiene acceso.
create policy "candidates_insert" on public.candidates
  for insert
  with check (
    auth.uid() = user_id
    and (
      exists (
        select 1 from public.projects p
         where p.id = project_id
           and p.user_id = auth.uid()
      )
      or public.puede_ver_proyecto(project_id)
    )
  );

--    EDITAR: dueño Y compañero. Aquí es donde el invitado "trabaja de verdad":
--    cambiar el estado del candidato, apuntar notas, corregir el teléfono.
create policy "candidates_update" on public.candidates
  for update
  using (auth.uid() = user_id or public.puede_ver_proyecto(project_id))
  with check (auth.uid() = user_id or public.puede_ver_proyecto(project_id));

--    BORRAR un candidato concreto: dueño y compañero. Es contenido del proceso,
--    no la carpeta entera; equivocarse aquí cuesta un candidato, no el proyecto.
create policy "candidates_delete" on public.candidates
  for delete
  using (auth.uid() = user_id or public.puede_ver_proyecto(project_id));

-- 5.c) ENTREVISTAS ───────────────────────────────────────────────────────────
--      Mismas reglas que candidatos. El update compartido es lo que permite al
--      compañero TRANSCRIBIR y RESUMIR: esas dos acciones no son más que escribir
--      en las columnas transcript_* y summary_* de esta tabla. Si el update fuera
--      solo del dueño, el invitado vería la entrevista pero el botón de
--      transcribir fallaría al guardar.
drop policy if exists "own interviews"    on public.interviews;
drop policy if exists "interviews_select" on public.interviews;
drop policy if exists "interviews_insert" on public.interviews;
drop policy if exists "interviews_update" on public.interviews;
drop policy if exists "interviews_delete" on public.interviews;

create policy "interviews_select" on public.interviews
  for select
  using (auth.uid() = user_id or public.puede_ver_proyecto(project_id));

create policy "interviews_insert" on public.interviews
  for insert
  with check (
    auth.uid() = user_id
    and (
      exists (
        select 1 from public.projects p
         where p.id = project_id
           and p.user_id = auth.uid()
      )
      or public.puede_ver_proyecto(project_id)
    )
  );

create policy "interviews_update" on public.interviews
  for update
  using (auth.uid() = user_id or public.puede_ver_proyecto(project_id))
  with check (auth.uid() = user_id or public.puede_ver_proyecto(project_id));

create policy "interviews_delete" on public.interviews
  for delete
  using (auth.uid() = user_id or public.puede_ver_proyecto(project_id));

-- 6) Los audios del bucket `recordings` ──────────────────────────────────────
--    Las grabaciones NO están en una tabla, están en Storage, que tiene sus
--    propios permisos. La política anterior ("recordings_own", de
--    supabase-migration-audio-nube.sql) decía simplemente "solo tu carpeta", así
--    que el compañero veía la entrevista compartida pero no podía reproducir el
--    audio: se lo bloqueaba el Storage.
--
--    LA RUTA DE CADA ARCHIVO ES:   {id del dueño}/{id de la entrevista}/{archivo}
--    ...que en la política se lee como:
--      (storage.foldername(name))[1]  → la PRIMERA carpeta = el dueño del audio
--      (storage.foldername(name))[2]  → la SEGUNDA carpeta = el id de la entrevista
--
--    Por eso la condición tiene dos ramas:
--      · Rama 1 — "el archivo está en mi carpeta": es mío, paso. Lo de siempre.
--      · Rama 2 — "el archivo es de una entrevista que puedo ver": se coge el id
--        de la entrevista de la segunda carpeta de la ruta, se mira a qué
--        proyecto pertenece y se pregunta si tengo acceso a ese proyecto. Esto es
--        lo que deja al compañero ESCUCHAR el audio de una carpeta compartida.
--
--    `using` y `with check` son idénticos a propósito: `using` gobierna leer y
--    borrar, `with check` gobierna subir y sobrescribir. Al ser iguales, el
--    compañero que vuelve a transcribir también puede volver a SUBIR el audio si
--    hiciera falta, no solo bajarlo.
--
--    Una sola política `for all` cubre las cuatro operaciones, igual que hacía la
--    anterior.
drop policy if exists "recordings_own" on storage.objects;
drop policy if exists "recordings_compartido" on storage.objects;
create policy "recordings_compartido" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'recordings'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.interviews i
         where i.id = (storage.foldername(name))[2]
           and public.puede_ver_proyecto(i.project_id)
      )
    )
  )
  with check (
    bucket_id = 'recordings'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.interviews i
         where i.id = (storage.foldername(name))[2]
           and public.puede_ver_proyecto(i.project_id)
      )
    )
  );

-- 7) Poder ver el NOMBRE de la persona con la que compartes ──────────────────
--    Sin esto, la app enseña correos sueltos en vez de nombres. La política de
--    perfiles que había ("own profile") solo deja leer el tuyo, así que al pintar
--    la lista de "compartido con" o la etiqueta "Compartido por Fulanito" no hay
--    ningún nombre que enseñar y hay que caer al correo.
--
--    Lo que se abre es MUY poco: solo puedes leer el perfil (nombre, correo, foto)
--    de alguien con quien compartes una carpeta concreta, en cualquiera de los dos
--    sentidos — o tú se la diste a él, o él te la dio a ti. Con nadie más.
--    Escribir sigue estando prohibido salvo en tu propio perfil: por eso la
--    política antigua se parte en dos, una de lectura y otra para el resto.
drop policy if exists "own profile"      on public.profiles;
drop policy if exists "profiles_leer"    on public.profiles;
drop policy if exists "profiles_propio"  on public.profiles;

create policy "profiles_leer" on public.profiles
  for select to authenticated
  using (
    auth.uid() = id
    or exists (
      select 1 from public.project_shares s
       where (s.owner_id = auth.uid() and s.shared_with_id = profiles.id)
          or (s.shared_with_id = auth.uid() and s.owner_id = profiles.id)
    )
  );

-- Crear / modificar / borrar: solo tu propio perfil, igual que siempre.
create policy "profiles_propio" on public.profiles
  for all to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ── Verificación (opcional) ──────────────────────────────────────────────────
-- Quita los guiones de delante y ejecuta cada select por separado para comprobar
-- que todo ha quedado creado. No hace falta para que la app funcione.
--
-- ¿Existe la tabla de compartidos?
-- select table_name from information_schema.tables
--   where table_schema = 'public' and table_name = 'project_shares';
--
-- ¿Están las dos funciones?
-- select routine_name, security_type from information_schema.routines
--   where routine_schema = 'public'
--     and routine_name in ('puede_ver_proyecto', 'buscar_usuario_por_correo');
--   -- las dos deben salir con security_type = 'DEFINER'
--
-- ¿Están las políticas nuevas de las tablas? (deben salir 3 de project_shares,
-- 4 de projects, 4 de candidates y 4 de interviews; y NINGUNA llamada
-- "own projects" / "own candidates" / "own interviews")
-- select tablename, policyname, cmd from pg_policies
--   where schemaname = 'public'
--     and tablename in ('project_shares', 'projects', 'candidates', 'interviews')
--   order by tablename, policyname;
--
-- ¿Y la del bucket de audios?
-- select policyname, cmd from pg_policies
--   where schemaname = 'storage' and tablename = 'objects'
--     and policyname = 'recordings_compartido';
--
-- ¿Con quién estoy compartiendo cosas ahora mismo?
-- select project_id, shared_with_email, created_at from public.project_shares
--   order by created_at desc;
