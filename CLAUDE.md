# Call Transcriber App — Contexto del Proyecto

## Qué es esta app
Aplicación de escritorio (React + Electron + Vite + TypeScript) para grabar, transcribir y resumir entrevistas de selección de personal. Usa Groq para transcripción y resumen con IA.

## Flujo de trabajo: Figma → Código
**El diseño se define primero en Figma, luego se implementa aquí.**

- Archivo Figma: `upskill | Client Proposal Valero`
- File key: `0k5r5kb77vM5LBlEHPqvtG`
- Página de trabajo: `David x España` (node `2002:63`)
- Acceso via API REST de Figma con token guardado en `~/.claude/settings.json`

Antes de implementar cualquier cambio visual, consultar el Figma para extraer colores, layout, tipografía y componentes exactos.

## Cómo acceder al Figma
```bash
curl -H "X-Figma-Token: <token>" \
  "https://api.figma.com/v1/files/0k5r5kb77vM5LBlEHPqvtG/nodes?ids=NODE_ID"
```
El token activo está en `C:\Users\Usuari\.claude\settings.json` → `mcpServers.figma.env.FIGMA_API_KEY`.

## Stack técnico
- Frontend: React 18 + TypeScript + Vite
- Desktop: Electron
- Estilos: CSS plano (App.css + index.css), sin framework
- Persistencia: localStorage
- IA: Groq API (transcripción con Whisper, resumen con LLaMA)

## Cómo conectar Claude a Figma (TalkToFigma MCP)

El MCP ya está instalado en `C:\Users\Usuari\.claude.json`. Para cada sesión:

1. Verificar si el servidor WebSocket ya corre: `netstat -ano | findstr :3055`
2. Si no corre, arrancarlo en background: `bunx cursor-talk-to-figma-socket`
3. En Figma → archivo `upskill | Client Proposal Valero` → Plugins → Talk To Figma MCP Plugin → Run → Connect
4. Dar el código de canal a Claude y ejecutar `mcp__TalkToFigma__join_channel`
5. Verificar con `mcp__TalkToFigma__get_document_info`

Si `bunx` no funciona usar: `C:\Users\Usuari\.bun\bin\bun.exe C:\Users\Usuari\.bun\install\cache\cursor-talk-to-figma-mcp@0.3.5@@@1\dist\server.js`

## Estado del diseño Figma — Página "Call Transcriber" (node 2439:222)

Todas las pantallas tienen barra de breadcrumb azul claro (40px) entre el top bar y el contenido, con el icono ⌂ como home. El breadcrumb arranca a x=288 (después del sidebar de 268px) en pantallas con sidebar, y a x=20 en las demás.

### Pantallas diseñadas y sus node IDs

| Pantalla | Node ID | Abs X | Abs Y | Breadcrumb |
|---|---|---|---|---|
| App — Main Screen | 2439:223 | 1380 | 0 | ⌂ / Valero Tech / Laura Martínez |
| App — Home / Dashboard | 2442:355 | 0 | 0 | (es el home, sin breadcrumb) |
| App — Tab Transcripción | 2443:583 | 2760 | 0 | ⌂ / Valero Tech / Ana García |
| App — Tab Resumen IA (Ejecutivo) | 2443:629 | 4140 | 0 | ⌂ / Valero Tech / Ana García |
| App — Proyecto Detalle | 2443:673 | 5520 | 0 | ⌂ / Valero Tech |
| App — Configuración | 2443:716 | 6900 | 0 | ⌂ / Configuración |
| App — Mi Perfil | 2443:757 | 8280 | 0 | ⌂ / Mi Perfil |
| Empty State — Sin candidatos | 2443:792 | 1380 | 920 | ⌂ / Valero Tech |
| App — Tab Resumen IA (Descriptivo) | 2445:836 | 4140 | 920 | ⌂ / Valero Tech / Ana García |

### Colores de marca
- Azul principal: #2563EB (r:0.145, g:0.388, b:0.922)
- Azul claro (fondos): #EFF6FF (r:0.937, g:0.965, b:1)
- Borde azul: #BFDBFE (r:0.749, g:0.859, b:0.996)

### Decisiones de diseño tomadas
- **Tab Transcripción**: panel izquierdo "Grabaciones" (284px) + área de transcripción derecha. Botón "Transcribir" manual por ítem. Mensaje de estado si la grabación está pendiente.
- **Tab Resumen IA**: dos variantes en frames separados — Ejecutivo (secciones con colores) y Descriptivo (prosa corrida). El dropdown tiene borde gris en Ejecutivo y azul en Descriptivo para diferenciarlos.
- **Coordenadas TalkToFigma**: create_* y move_node con parentId usan coordenadas RELATIVAS al frame padre. Restar siempre la posición absoluta del padre.
