import { addDays, iso, money, parseIso, type Nota } from "./util";

export type Calendario = { id: string; nombre: string; principal: boolean };
export type EstadoGoogle = { incluidas: boolean; credenciales: boolean; conectado: boolean; calendario: Calendario | null };
export type Resultado = { creados: number; actualizados: number; borrados: number };

async function invoke<T>(cmd: string, args?: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export const estado = () => invoke<EstadoGoogle>("google_estado");
export const cargarCredenciales = (path: string) => invoke<void>("google_cargar_credenciales", { path });
export const conectar = () => invoke<void>("google_conectar");
export const calendarios = () => invoke<Calendario[]>("google_calendarios");
export const elegirCalendario = (c: Calendario) => invoke<void>("google_elegir_calendario", { id: c.id, nombre: c.nombre });
export const desconectar = () => invoke<void>("google_desconectar");

/** Evento de día completo que representa a la nota en Google Calendar. */
function eventoDe(n: Nota) {
  const partes: string[] = [];
  if (n.series) partes.push(`Cuota ${n.series.n} de ${n.series.total}`);
  else if (n.anual) partes.push("Anual");
  if (n.desc) partes.push(n.desc);
  if (n.links?.length) partes.push(n.links.map((l) => l.url).join("\n"));
  partes.push("— Creado por Notes");
  return {
    id: n.id,
    summary: `${n.done ? "✓ " : ""}${n.title}${n.amount != null ? ` · ${money(n.amount)}` : ""}`,
    description: partes.join("\n\n"),
    date: n.date,
    end: iso(addDays(parseIso(n.date), 1)),
    reminder: !n.done,
    privado: n.privado === true,
  };
}

/** Solo las notas que se comparten; las demás se borran de Google si estaban. */
export const sincronizar = (notes: Nota[]) =>
  invoke<Resultado>("google_sync", { eventos: notes.filter((n) => n.gcal !== false).map(eventoDe) });

/** «hace 2 min», «hace 1 h»… */
export function haceCuanto(d: Date) {
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "recién";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return d.toLocaleDateString("es-AR");
}
