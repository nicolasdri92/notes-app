Construí una app de escritorio con **Tauri v2** llamada **Agenda**: un gestor minimalista de recordatorios con fecha (vencimientos de impuestos, pagos, trámites). Toda la interfaz en español (es-AR).

La especificación completa está en `README.md` de esta carpeta. Ahí están las pantallas, las medidas, los tokens de color claro/oscuro, los estados, la lógica de urgencia y los atajos. Los diseños de referencia están en `design/`: abrí `design/Agenda – Pantallas y guía.dc.html` en el navegador para verlos. Son prototipos HTML de referencia: recreá la UI fielmente, no copies ese código.

Requisitos:
1. Ventana fija de 900×640, no redimensionable, sin maximizar, `decorations: false`, con barra de título propia (`data-tauri-drag-region`) y botones de minimizar/cerrar.
2. Frontend en HTML/CSS/TypeScript, sin frameworks pesados (vanilla o Svelte). Estilos con variables CSS para tema claro/oscuro (sigue `prefers-color-scheme` y se puede alternar; persistir la elección).
3. Datos: notas con título (obligatorio), fecha (obligatoria), descripción y monto ARS opcionales, y estado hecho/pendiente. Persistencia local en JSON (`plugin-store` o `plugin-fs` en `appDataDir`), guardando en cada cambio.
4. Lista agrupada en Vencidas / Esta semana / Próximas / Hechas (colapsada), con badge de urgencia rojo/ámbar/neutro según el README.
5. Panel lateral para crear, ver, editar y eliminar (con confirmación y "Deshacer"), calendario propio con atajos (Hoy, Mañana, En una semana, Fin de mes), validación de título y formateo de montos es-AR.
6. Buscador en vivo, sin distinguir acentos. Atajos: Ctrl/Cmd+N, Ctrl/Cmd+K, Ctrl/Cmd+Enter y Esc.
7. Tipografía Geist empaquetada localmente.

Empezá por el scaffold de Tauri y la configuración de la ventana, después los tokens y los componentes base, después la lista, el panel y la persistencia. Al terminar, verificá cada pantalla del README en ambos temas.
