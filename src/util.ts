export type Frecuencia = "mensual" | "bimestral" | "cuotas";

/** Vínculo entre los vencimientos creados juntos (p. ej. cuota 2 de 6). */
export type Serie = {
  id: string; n: number; total: number; freq: Frecuencia;
  /** Monto que dura 2 meses: paridad de la primera cuota de cada par (0 o 1). Ausente = sin pares. */
  par?: number | null;
};

/** Cuota que comparte monto con la cuota `s.n`, si la serie tiene montos de a pares. */
export const cuotaPar = (s: Serie) => (s.par == null ? null : (s.n - s.par) % 2 === 0 ? s.n + 1 : s.n - 1);

/** Copia de un archivo guardada por la app de escritorio. */
export type Adjunto = { id: string; name: string; size: number };

export type Enlace = { id: string; url: string };

export type Nota = {
  id: string;
  title: string;
  /** 'YYYY-MM-DD', fecha local sin hora */
  date: string;
  amount: number | null;
  desc: string;
  done: boolean;
  series?: Serie | null;
  /** Vencimiento único marcado como anual (chip «Anual»). */
  anual?: boolean;
  files?: Adjunto[];
  links?: Enlace[];
  /** false = no se muestra en Google Calendar (sin definir = sí). */
  gcal?: boolean;
};

export type Tema = "claro" | "oscuro";

export type Urgencia = "red" | "amber" | "neutral" | "done";

export const MES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
const MESL = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export const sod = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
export const today = () => sod(new Date());
export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const parseIso = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
/** Suma meses conservando el día; si no existe (31 → abril), usa el último del mes. */
export const addMonths = (d: Date, k: number) => {
  const y = d.getFullYear(), m = d.getMonth() + k;
  return new Date(y, m, Math.min(d.getDate(), new Date(y, m + 1, 0).getDate()));
};
export const shortDate = (d: Date) => `${d.getDate()} ${MES[d.getMonth()].toLowerCase()}`;
export const firstOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
/** Días de `a` respecto de `b` (redondeado: absorbe cambios de horario). */
export const diffDays = (a: Date, b: Date) => Math.round((sod(a).getTime() - sod(b).getTime()) / 864e5);

const moneyFmt = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" });
const inputFmt = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2, useGrouping: false });
export const money = (n: number) => moneyFmt.format(n);
export const fmtAmountInput = (n: number | null) => (n == null ? "" : inputFmt.format(n));
/** Punto o coma valen como separador decimal: "38450.5" y "38450,5" → 38450.5.
 *  Si hay varios, el último es el decimal y los anteriores se ignoran. */
export const parseAmount = (s: string): number | null => {
  const limpio = (s || "").replace(/[^\d.,-]/g, "").replace(/,/g, ".");
  if (!limpio) return null;
  const i = limpio.lastIndexOf(".");
  const normal = i < 0 ? limpio : limpio.slice(0, i).replace(/\./g, "") + "." + limpio.slice(i + 1);
  const v = parseFloat(normal);
  return isNaN(v) ? null : Math.round(v * 100) / 100;
};

export const fmtSize = (b: number) =>
  b < 1024 ? `${b} B`
  : b < 1048576 ? `${Math.round(b / 1024).toLocaleString("es-AR")} KB`
  : `${(b / 1048576).toLocaleString("es-AR", { maximumFractionDigits: 1 })} MB`;

/** Completa `https://` si falta. Solo acepta web y correo; si no es válido devuelve null. */
export function normUrl(s: string): string | null {
  let t = s.trim();
  if (!t) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(t)) t = "https://" + t;
  try {
    const u = new URL(t);
    if (!["http:", "https:", "mailto:"].includes(u.protocol)) return null;
    if (u.protocol !== "mailto:" && !u.hostname.includes(".")) return null;
    return u.href;
  } catch {
    return null;
  }
}

/** "https://www.arba.gov.ar/pagos/" → "arba.gov.ar/pagos" */
export function urlCorta(url: string) {
  try {
    const u = new URL(url);
    if (u.protocol === "mailto:") return u.pathname;
    const path = u.pathname.replace(/\/$/, "");
    return u.hostname.replace(/^www\./, "") + path + u.search;
  } catch {
    return url;
  }
}

export const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const longDate = (d: Date) => `${DIA[d.getDay()]} ${d.getDate()} de ${MESL[d.getMonth()]}`;
export const monthTitle = (d: Date) => `${cap(MESL[d.getMonth()])} ${d.getFullYear()}`;
export const rel = (dd: number) =>
  dd === 0 ? "hoy" : dd === 1 ? "mañana" : dd === -1 ? "ayer" : dd > 0 ? `en ${dd} días` : `hace ${-dd} días`;

export function urgencia(n: Nota, t: Date): { d: Date; dd: number; kind: Urgencia; label: string } {
  const d = parseIso(n.date);
  const dd = diffDays(d, t);
  if (n.done) return { d, dd, kind: "done", label: "Hecha" };
  if (dd < 0) return { d, dd, kind: "red", label: dd === -1 ? "Venció ayer" : `Venció hace ${-dd} días` };
  if (dd === 0) return { d, dd, kind: "amber", label: "Vence hoy" };
  if (dd === 1) return { d, dd, kind: "amber", label: "Vence mañana" };
  return { d, dd, kind: dd <= 3 ? "amber" : "neutral", label: `En ${dd} días` };
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
