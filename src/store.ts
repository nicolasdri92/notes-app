import type { Adjunto, Nota, Tema } from "./util";

export type Datos = { notes: Nota[]; theme: Tema | null };

/** Fuera de Tauri (p. ej. `npm run dev` en el navegador) se usa localStorage. */
export const isTauri = "__TAURI_INTERNALS__" in window;

const LS_KEY = "agenda-datos";

export async function load(): Promise<Datos> {
  if (isTauri) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<Datos>("load_data");
  }
  try {
    const s = localStorage.getItem(LS_KEY);
    if (s) return JSON.parse(s);
  } catch {}
  return { notes: [], theme: null };
}

/** Abre el selector de archivos del sistema. Devuelve rutas (vacío si se cancela). */
export async function elegirArchivos(): Promise<string[]> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const r = await open({ multiple: true, directory: false, title: "Adjuntar archivos" });
  return r == null ? [] : Array.isArray(r) ? r : [r];
}

/** Copia los archivos a la carpeta de la app y devuelve sus datos. */
export async function adjuntar(paths: string[]): Promise<Adjunto[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<Adjunto[]>("adjuntar", { paths });
}

export async function abrirLink(url: string) {
  if (!isTauri) {
    window.open(url, "_blank", "noopener");
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("abrir_link", { url });
}

export async function abrirAdjunto(id: string) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("abrir_adjunto", { id });
}

// Las escrituras se encadenan para que nunca lleguen fuera de orden.
let cola: Promise<void> = Promise.resolve();

export function save(d: Datos) {
  const copia: Datos = { notes: d.notes.map((n) => ({ ...n })), theme: d.theme };
  cola = cola
    .then(async () => {
      if (isTauri) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("save_data", { data: copia });
      } else {
        localStorage.setItem(LS_KEY, JSON.stringify(copia));
      }
    })
    .catch((e) => console.error("No se pudo guardar la agenda", e));
}
