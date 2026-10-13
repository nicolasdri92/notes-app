# Handoff: Agenda — app de escritorio de recordatorios (Tauri)

## Overview
App de escritorio minimalista para anotar y ver recordatorios con fecha (vencimientos de impuestos, pagos de servicios, trámites). Solo dos funciones: **agregar notas** y **verlas**, más detalle/edición/eliminación, búsqueda y modo claro/oscuro. Toda la UI en español (es-AR).

## About the Design Files
Los archivos de `design/` son **referencias de diseño hechas en HTML** (prototipos que muestran aspecto y comportamiento), no código de producción para copiar. La tarea es **recrearlos en una app Tauri** con HTML/CSS/JS (o el framework frontend liviano que se prefiera: vanilla, Svelte, Preact). Abrir `design/Agenda – Pantallas y guía.dc.html` en un navegador para ver todas las pantallas en ambos temas (cada ventana es interactiva).

## Fidelity
**Alta fidelidad.** Colores, tipografía, espaciados y estados son finales. Recrear pixel-perfect.

## Ventana
- Tamaño fijo **900 × 640**, no redimensionable, sin maximizar.
- `tauri.conf.json`: `"width": 900, "height": 640, "resizable": false, "maximizable": false, "decorations": false` (barra de título propia).
- Barra superior propia de 44px con `data-tauri-drag-region`. Botones de ventana a la derecha (estilo Windows): minimizar y cerrar, 44×44, glifo 14px trazo 1.1; hover minimizar `--surface2`, hover cerrar `#C42B1C` con glifo blanco. Usar `appWindow.minimize()` / `appWindow.close()`.

## Modelo de datos
```ts
type Nota = {
  id: string;
  title: string;        // obligatorio
  date: string;         // 'YYYY-MM-DD', obligatorio (fecha local, sin hora)
  amount: number|null;  // ARS, opcional
  desc: string;         // opcional, texto libre corto (multilínea)
  done: boolean;
}
```
Persistir localmente (archivo JSON en `appDataDir` vía `@tauri-apps/plugin-fs`, o `plugin-store`). Guardar en cada cambio. Guardar también el tema elegido.

## Lógica de fechas y urgencia
`dd = días entre fecha de la nota y hoy` (ambas a las 00:00 locales).
- **Vencida** (rojo): `!done && dd < 0` → "Venció ayer" / "Venció hace N días".
- **Ámbar**: `!done && 0 ≤ dd ≤ 3` → "Vence hoy" / "Vence mañana" / "En N días".
- **Neutro**: `dd > 3` → "En N días" (sin fondo, color `--text3`).
- **Hecha**: label "Hecha" (neutro).

Grupos (en este orden; ocultar grupos vacíos):
1. **Vencidas** — `!done && dd < 0`. Encabezado con punto rojo de 6px.
2. **Esta semana** — `!done && 0 ≤ dd ≤ 6`.
3. **Próximas** — `!done && dd > 6`.
4. **Hechas** — `done`. **Colapsada por defecto**; clic en el encabezado alterna (chevron rota 0°→90°, 150ms).

Orden: ascendente por fecha; "Hechas" descendente. Al buscar, "Hechas" se muestra expandida y sin toggle.

Formato de monto: `Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS'})` → `$ 184.560,00`. Mes abreviado en mayúsculas: ENE FEB MAR ABR MAY JUN JUL AGO SEP OCT NOV DIC. Fecha larga: "Lunes 13 de octubre de 2026".

## Pantallas

### 1. Vista principal (lista)
- **Barra superior** (44px, borde inferior 1px `--border`, padding-left 16):
  - Izquierda (150px): ícono calendario 16px color `--accent` + "Agenda" 13/600, letter-spacing -0.01em.
  - Centro: buscador (ver 5).
  - Derecha (150px): botón tema 28×28 (luna en claro, sol en oscuro, color `--text2`, hover `--surface2`) + botón primario "+ Nueva nota" (28px alto, padding 0 10 0 8, radio 7, 12.5/500, gap 6, title "Nueva nota (Ctrl+N)").
- **Contenido**: scroll vertical; columna centrada `max-width 680px`, padding `22px 28px 56px`, grupos separados por 26px.
- **Encabezado de grupo**: 12/600 `--text2`, contador 12/500 `--text3` tabular, padding `0 12px 6px`.
- **Fila de nota** (gap entre filas 2px): flex, gap 14, padding `10px 12px`, radio 10, hover fondo `--surface2` (transición 120ms). De izquierda a derecha:
  1. Checkbox 18×18, radio 5, borde 1.5px `--borderStrong`; marcado: fondo y borde `--accent`, check blanco (trazo 2.2). El clic NO abre el detalle (stopPropagation).
  2. Bloque fecha 36px de ancho centrado: día 20/600, letter-spacing -0.03em, tabular (color `--red` si vencida, si no `--text`); debajo (4px) mes 10/600, +0.08em, `--text3`.
  3. Título 13.5/500 una línea con ellipsis; debajo (3px) primera línea de la descripción 12/400 `--text3` ellipsis (si existe).
  4. Monto 13/500 `--text2` tabular (si existe).
  5. Badge de urgencia, alineado a la derecha en una columna de 118px.
- **Nota hecha**: todo salvo el checkbox con opacity 0.45; título y monto tachados.
- **Nota recién creada**: anillo `inset 0 0 0 1px --accent, 0 0 0 3px --accentSoft` durante 1.8s.
- **Fila seleccionada** (panel abierto sobre ella): `inset 0 0 0 1px --borderStrong`.

### 2. Nueva nota (panel lateral)
- Se abre con el botón o **Ctrl+N** (Cmd+N en macOS). Foco automático en Título.
- Scrim sobre el contenido debajo de la barra: `--scrim`; clic en el scrim cierra.
- Panel: anclado a la derecha, top 44px, 380px de ancho, fondo `--surface`, borde izquierdo `--border`, sombra `-16px 0 40px --shadow`. Columna: header 52px / cuerpo con scroll / footer.
- Header: "Nueva nota" 14/600 + botón cerrar ×, 28×28.
- Cuerpo (padding `4px 20px 20px`, gap 18 entre campos). Labels 12/500 `--text2`; "Opcional" a la derecha 11.5 `--text3`.
  - **Título**: input 36px, padding 0 11, radio 8, borde `--border`, 13.5px. Focus: borde `--accent` + `box-shadow 0 0 0 3px --accentSoft`. Placeholder "Ej. Vencimiento IVA – Septiembre". Enter guarda.
  - **Fecha**: a la derecha del label, la fecha elegida en texto 12/500, p. ej. "Lunes 18 de octubre · en 5 días".
    - Chips de atajo (26px, padding 0 10, radio 6, 12/500, borde `--border`, color `--text2`): **Hoy, Mañana, En una semana, Fin de mes**. Activo: fondo `--accentSoft`, color `--accent`, sin borde.
    - Calendario siempre visible: caja con borde `--border`, radio 10, padding `8px 10px 10px`. Header: "Octubre 2026" 12.5/600 + flechas ‹ › de 26×26. Semana empieza en lunes: L M M J V S D (10.5/500 `--text3`). Celdas 30px alto, radio 7, 12.5px tabular. Día seleccionado: fondo `--accent`, texto `--onAccent`, 600. Hoy: texto `--accent` 600 + anillo `inset 0 0 0 1px --accentSoft`. Días de otro mes: opacity 0.35. Mostrar solo las filas necesarias (5 o 6).
    - Por defecto: hoy.
  - **Monto**: caja 36px con prefijo "$" y sufijo "ARS" (`--text3`); `inputmode="decimal"`, placeholder "0,00". Acepta "184.560,5"; al perder foco se formatea a es-AR (`184.560,5`).
  - **Descripción**: textarea 3 filas, padding 9 11, 13px, line-height 1.5, sin resize. Placeholder "Cómo pagar, número de cuenta, recordatorios…".
- Footer (padding 12 20, borde superior): a la izquierda "Ctrl ↵ para guardar" 11.5 `--text3`; a la derecha "Cancelar" (botón fantasma) y "Guardar" (primario 32px). Guardar al 50% de opacidad si el título está vacío.
- **Validación**: si se intenta guardar sin título → borde del input `--red` y mensaje "Escribí un título para la nota." (12px `--red`).
- Al guardar: se cierra el panel, se limpia la búsqueda y se resalta la nota nueva.

### 3. Detalle / edición
- Clic en una fila abre el mismo panel en modo detalle.
- Header: botón toggle con checkbox + "Marcar como hecha" / "Hecha" (12.5/500) a la izquierda; cerrar × a la derecha.
- Cuerpo (padding `12px 24px 24px`, gap 22):
  - Bloque fecha 56×60, radio 12, fondo `--surface2`: día 24/600, mes 10/600.
  - A la derecha: título 19/600, line-height 1.3, -0.015em (tachado si está hecha); debajo, fecha larga 12.5 `--text2` + badge de urgencia (o "· En N días" neutro).
  - Separador 1px.
  - "Monto" (11.5/500 `--text3`) → valor 22/600 tabular, o "Sin monto".
  - "Descripción" → texto 13.5, line-height 1.6, `white-space: pre-wrap`, o "Sin descripción".
- Footer: "Eliminar" (fantasma rojo con ícono papelera, hover `--redSoft`) a la izquierda; "Editar" (secundario) a la derecha.
- **Eliminar**: el footer pasa a confirmación sobre fondo `--redSoft`: "¿Eliminar esta nota?" + "Cancelar" + "Eliminar" (fondo `--red`). Al confirmar: se cierra el panel y aparece un toast abajo al centro, "Nota eliminada · Deshacer" (fondo `--text`, texto `--bg`, radio 9, 36px), durante 5s. Deshacer reinserta la nota en su posición.
- **Editar**: mismo formulario precargado, título "Editar nota", botón "Guardar cambios". Cancelar o Esc vuelven al detalle.

### 4. Estado vacío
Centrado verticalmente (min-height 440): cuadrado 56×56 radio 16 fondo `--surface2` con ícono calendario 24px; "Tu agenda está vacía" 16/600; "Anotá vencimientos, pagos o trámites y los vas a ver ordenados por fecha." 13px `--text2` max-width 300; botón primario 34px "+ Crear la primera nota"; "o presioná [Ctrl N]" 12px `--text3`.

### 5. Búsqueda
- En la barra: 28px de alto, hasta 300px de ancho, radio 7, fondo `--surface2`, ícono lupa 14px, placeholder "Buscar notas", indicador "Ctrl K" (10.5px, borde `--border`, radio 4). Con texto escrito se muestra un botón × para limpiar.
- Filtra en vivo por título y descripción, sin distinguir mayúsculas ni acentos (normalize NFD).
- Sin resultados: "Sin resultados para “x”" 14/600 + "Probá con otra palabra o revisá la ortografía." 12.5 `--text2`.
- Esc en el buscador lo limpia y le quita el foco.

## Atajos
- **Ctrl/Cmd+N**: nueva nota (usar `preventDefault`)
- **Ctrl/Cmd+K**: enfocar el buscador
- **Ctrl/Cmd+Enter**: guardar el formulario
- **Esc**: cancelar la confirmación → cerrar el panel (o volver al detalle desde la edición)

## Design tokens
Variables CSS en `:root` (claro) y `[data-theme="oscuro"]`. El tema inicial sigue `prefers-color-scheme` y se puede alternar con el botón; la elección se persiste.

| token | claro | oscuro |
|---|---|---|
| --bg | #F7F6F3 | #1A1917 |
| --surface | #FFFFFF | #22211F |
| --surface2 | #EFEDE8 | #2B2A27 |
| --border | #E5E2DC | #33312E |
| --borderStrong | #D3CFC7 | #46433E |
| --text | #1F1D1A | #ECE9E3 |
| --text2 | #67635B | #A6A198 |
| --text3 | #9A958B | #77736B |
| --accent | #2F6B5E | #7DBDAA |
| --accentHover | #275A4F | #95CBBB |
| --accentSoft | #E1ECE8 | rgba(125,189,170,.16) |
| --onAccent | #FFFFFF | #0F1F1A |
| --red | #B04A3A | #E59B8C |
| --redSoft | #F6E5E0 | rgba(229,155,140,.13) |
| --amber | #8F6118 | #DDB56E |
| --amberSoft | #F4EAD3 | rgba(221,181,110,.13) |
| --scrim | rgba(31,29,26,.14) | rgba(0,0,0,.35) |
| --shadow | rgba(40,32,20,.10) | rgba(0,0,0,.35) |

**Tipografía**: Geist 400/500/600 (empaquetarla localmente; no depender de Google Fonts en runtime). Base 13px, `-webkit-font-smoothing: antialiased`. Números con `font-variant-numeric: tabular-nums`. Escala: 22/600 · 20/600 · 19/600 · 16/600 · 14/600 · 13.5/500 · 13/400–500 · 12.5 · 12 · 11.5 · 10.5 · 10/600 en mayúsculas.

**Espaciado** (base 4): 4, 6, 8, 12, 14, 18, 20, 22, 26, 28.
**Radios**: 5 checkbox/kbd · 6 badge/chips · 7 botones/buscador · 8 inputs · 10 filas/calendario · 12 bloque de fecha del detalle · 16 ícono del estado vacío.
**Alturas**: barra 44 · botón chico 28 · botón 32 · botón grande 34 · input 36 · badge 22 · chip 26 · celda de calendario 30 · panel 380 de ancho.

**Componentes**
- Botón primario: fondo `--accent`, texto `--onAccent`, 13/500, radio 7; hover `--accentHover`.
- Secundario: fondo `--surface`, borde 1px `--borderStrong`, texto `--text`; hover `--surface2`.
- Fantasma: transparente, `--text2`; hover fondo `--surface2`, texto `--text`.
- Peligro: transparente, `--red`; hover `--redSoft`.
- Badge: 22px, padding 0 8, radio 6, 11.5/500, punto de 5px `currentColor` + gap 6. Rojo: `--redSoft`/`--red`. Ámbar: `--amberSoft`/`--amber`. Neutro/Hecha: sin fondo, `--text3`, sin punto.

## Assets
Sin imágenes. Íconos lineales simples (16×16 viewBox, trazo 1.4–1.6, puntas redondeadas): calendario, lupa, más, ×, check, chevron ‹ ›, luna, sol, papelera, minimizar, cerrar. Se pueden reemplazar por Lucide con el mismo trazo.

## Files
- `design/Agenda.dc.html`: la app interactiva completa (la lógica está en la clase `Component`: grupos, urgencia, calendario, formato de montos, atajos).
- `design/Agenda – Pantallas y guía.dc.html`: todas las pantallas en claro y oscuro + guía de estilos.
- `design/support.js`: runtime necesario para abrir los `.dc.html` en el navegador (solo para verlos; no forma parte de la app).
