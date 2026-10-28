# Notes

App de escritorio minimalista (Tauri v2 + TypeScript sin frameworks) para anotar vencimientos, pagos y trámites.

## Requisitos (Linux / Ubuntu)

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Librerías de sistema para Tauri v2
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

## Uso

```bash
npm install
npm run tauri dev     # app en desarrollo
npm run tauri build   # instalables (.deb, .rpm, AppImage) en src-tauri/target/release/bundle/
```

`npm run dev` levanta solo el frontend en http://localhost:1420 (guarda en localStorage), útil para iterar estilos.

## Estructura

- `src/main.ts`: estado, renderizado, panel lateral, atajos
- `src/util.ts`: fechas, urgencia, formato de montos
- `src/store.ts`: persistencia (comandos Tauri o localStorage)
- `src/styles.css`: tokens claro/oscuro y componentes
- `src-tauri/src/lib.rs`: comandos `load_data` / `save_data`; guardan en `~/.local/share/com.nicolasdri.agenda/agenda.json`
- `src/comprobantes.ts` + `src-tauri/src/comprobante.rs`: descarga de comprobantes desde sitios con captcha

## Comprobantes

En el detalle de una nota, **Configurar descarga automática** guarda los datos del sitio (por ejemplo,
titular y partida de Obras Sanitarias). **Descargar** abre el sitio en una ventana de la app con el
formulario completo; vos resolvés el captcha y el PDF se adjunta solo a la nota.

Para sumar un sitio: agregalo a `SITIOS` en `src/comprobantes.ts` y su dominio en
`src-tauri/capabilities/comprobante.json` (es lo único que esa ventana puede hacer: entregar el PDF).

## Google Calendar

Notes crea un evento de día completo por cada nota en el calendario que elijas y lo mantiene al día
(al iniciar la app y a los pocos segundos de cada cambio). Solo toca los eventos que creó ella.

### Configuración en Google Cloud (una sola vez)

1. Entrá a <https://console.cloud.google.com/projectcreate>, creá un proyecto llamado **Notes**.
2. Habilitá la API de Calendar: <https://console.cloud.google.com/apis/library/calendar-json.googleapis.com> → **Habilitar**.
3. Andá a **Google Auth Platform** (<https://console.cloud.google.com/auth/overview>) → **Comenzar**:
   - Nombre de la app: `Notes`; correo de asistencia: tu Gmail.
   - Público: **Externo**. Correo de contacto: tu Gmail. Aceptá y **Crear**.
4. En **Público** tocá **Publicar app** → **Confirmar** (queda «En producción»).
   Si queda en «Prueba», Google corta la conexión cada 7 días.
5. En **Clientes** → **Crear cliente** → Tipo **App de escritorio** → Nombre `Notes` → **Crear** →
   **Descargar JSON**.
6. En Notes: ícono de la nube (arriba a la derecha) → **Elegir archivo JSON…** → **Conectar con Google**
   → elegí el calendario.

Al autorizar, Google muestra «Google no verificó esta app»: es normal porque la app es tuya y no está
publicada para otros. Tocá **Configuración avanzada** → **Ir a Notes (no seguro)** → **Continuar**.

Las credenciales y la conexión quedan en `~/.local/share/com.nicolasdri.agenda/google.json`
(solo legible por tu usuario). **Desconectar** revoca el acceso en Google; los eventos ya creados quedan.
