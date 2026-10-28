import { addDays, addMonths, firstOfMonth, iso, parseIso, type Adjunto, type Comprobante, type Nota } from "./util";

/** Campo que el usuario completa una vez por nota (titular, partida…). */
export type Campo = { id: string; label: string; opciones?: string[] };

/** Datos leídos del PDF descargado. */
export type Lectura = { fecha: string; monto: number };

/** Acción sobre el formulario del sitio: elegir en un combo o escribir en un campo. */
type Paso = { elegir: string; texto: string } | { escribir: string; valor: string };

/**
 * Sitio desde el que se descarga un comprobante. Para sumar uno, agregar su dominio también
 * en `src-tauri/capabilities/comprobante.json`.
 */
export type Sitio = {
  id: string;
  nombre: string;
  url: string;
  campos: Campo[];
  /** Resumen de los datos guardados que se muestra en la nota. */
  resumen: (datos: Record<string, string>) => string;
  /** Mes que cubre el comprobante, según la fecha del vencimiento. */
  periodo: (vencimiento: Date) => Date;
  /** Cómo completar el formulario con los datos guardados y el período. */
  pasos: (datos: Record<string, string>, periodo: Date) => Paso[];
  /** Fragmento de la URL de la respuesta que trae el PDF. Sin él, vale cualquier respuesta con un PDF. */
  captura?: string;
  /** Qué hace el usuario en el sitio una vez completo el formulario. */
  instruccion: string;
  /** Lee el vencimiento y el monto del texto del PDF; null si no los encuentra. */
  leer?: (texto: string) => Lectura | null;
  /** Puertos del mismo host que sirven el certificado sin sus intermedios (ver `reparar_tls`). */
  puertosTls?: number[];
};

export const SITIOS: Sitio[] = [
  {
    id: "os-concordia",
    nombre: "Obras Sanitarias Concordia",
    url: "https://serviciostributarios.concordia.gob.ar/reimprimir/tasas-obras-sanitarias",
    campos: [
      { id: "titular", label: "Número de titular" },
      { id: "tipoPartida", label: "Tipo de partida", opciones: ["Partida municipal", "Partida provincial"] },
      { id: "partida", label: "Número de partida" },
    ],
    resumen: (d) => `Titular ${d.titular} · ${d.tipoPartida} ${d.partida}`,
    // Se paga mes vencido: el vencimiento de noviembre es la cuota 10 (octubre).
    periodo: (v) => addMonths(firstOfMonth(v), -1),
    pasos: (d, f) => [
      { elegir: "#tipoBoletaReimprimir", texto: "TSS - Tasa Servicios Sanitarios" },
      { escribir: "num", valor: d.titular },
      { elegir: "#tipoPartida", texto: d.tipoPartida },
      { escribir: "partida", valor: d.partida },
      { escribir: "anio", valor: String(f.getFullYear()) },
      { escribir: "cuota", valor: String(f.getMonth() + 1) },
    ],
    captura: "/reimpresion",
    instruccion: "Marcá «No soy un robot» y tocá «Consultar boleta». El PDF se adjunta solo a la nota.",
    leer: leerObrasSanitarias,
  },
  {
    id: "gasnea",
    nombre: "GASNEA",
    url: "https://oficinavirtual.gasnea.com.ar/ingreso/bienvenida",
    campos: [],
    resumen: () => "Factura desde la oficina virtual",
    // La factura del período 9 vence en octubre.
    periodo: (v) => addMonths(firstOfMonth(v), -1),
    pasos: () => [],
    // Sin filtro: la factura llega en la respuesta de un trabajo asíncrono (`async_request/jobs/…`).
    instruccion: "Iniciá sesión (la primera vez), andá a Facturas y descargá la que corresponda. El PDF se adjunta solo a la nota.",
    leer: leerGasnea,
  },
  {
    id: "coopelec",
    nombre: "COOPELEC",
    url: "https://www.e-coopelec.com.ar/oficinavirtual/auth/inicial",
    campos: [],
    resumen: () => "Factura desde la oficina virtual",
    // La factura emitida en septiembre vence en octubre.
    periodo: (v) => addMonths(firstOfMonth(v), -1),
    pasos: () => [],
    captura: "/genera-pdf-factura/",
    instruccion: "Iniciá sesión (la primera vez), entrá a las facturas de energía y descargá la que corresponda. El PDF se adjunta solo a la nota.",
    leer: leerCoopelec,
    // La API (3958) y los PDF (3979) no envían los certificados intermedios.
    puertosTls: [3958, 3979],
  },
];

/** Fecha a partir del año (2 dígitos) y el día del año (3), como vienen en los códigos de barras. */
const deDiaDelAnio = (aa: string, ddd: string) => addDays(new Date(2000 + Number(aa), 0, 1), Number(ddd) - 1);
const dosDigitos = (n: number) => String(n).padStart(2, "0");
/** `dd/mm/aaaa`, o `dd/mm/aa` con `corto`. */
const fechaEscrita = (f: Date, corto = false) =>
  `${dosDigitos(f.getDate())}/${dosDigitos(f.getMonth() + 1)}/${corto ? dosDigitos(f.getFullYear() % 100) : f.getFullYear()}`;

/**
 * Boleta de Obras Sanitarias: el código de barras (39 dígitos) termina en
 * monto del 1° vencimiento en centavos (8) · año (2) · día del año (3) · recargo del 2° (6) · días al 2° (2) · verificador (1).
 * Solo se acepta si la fecha y el monto también figuran escritos en la boleta.
 */
export function leerObrasSanitarias(texto: string): Lectura | null {
  for (const [codigo] of texto.matchAll(/\b17\d{37}\b/g)) {
    const c = codigo.slice(-22);
    const centavos = Number(c.slice(0, 8));
    const fecha = deDiaDelAnio(c.slice(8, 10), c.slice(10, 13));
    const montoTxt = `${Math.floor(centavos / 100)},${dosDigitos(centavos % 100)}`;
    if (centavos > 0 && texto.includes(fechaEscrita(fecha)) && texto.includes(montoTxt)) return { fecha: iso(fecha), monto: centavos / 100 };
  }
  return null;
}

/**
 * Factura de GASNEA: el texto extraído separa etiquetas de valores, así que el vencimiento es la
 * fecha más tardía (las otras son emisión y lecturas) y el total es el importe que también figura
 * en el código de pago.
 */
export function leerGasnea(texto: string): Lectura | null {
  const fechas = [...texto.matchAll(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g)].map(([, d, m, y]) => `${y}-${m}-${d}`).sort();
  const codigos = [...texto.matchAll(/\d{40,}/g)].map(([c]) => c);
  const montos = [...texto.matchAll(/\$ ?([\d.]+,\d{2})\b/g)]
    .map(([, m]) => Number(m.replaceAll(".", "").replace(",", ".")))
    .filter((m) => m > 0 && codigos.some((c) => c.includes(String(Math.round(m * 100)))));
  if (!fechas.length || !montos.length) return null;
  return { fecha: fechas[fechas.length - 1], monto: Math.max(...montos) };
}

/**
 * Factura de COOPELEC: el código de barras (52 dígitos) trae
 * "96" · monto del 1° vencimiento en centavos (12) · año (2) y día del año (3) · n° interno (15) ·
 * monto del 2° (12) · año y día del 2° (5) · verificador (1).
 * El total no figura escrito (suma energía y otros servicios), así que se exige que los dos
 * vencimientos y el n° interno sí lo estén.
 */
export function leerCoopelec(texto: string): Lectura | null {
  for (const [c] of texto.matchAll(/\b96\d{50}\b/g)) {
    const centavos = Number(c.slice(2, 14));
    const fecha = deDiaDelAnio(c.slice(14, 16), c.slice(16, 19));
    const fecha2 = deDiaDelAnio(c.slice(46, 48), c.slice(48, 51));
    const interno = c.slice(26, 34);
    if (centavos > 0 && texto.includes(fechaEscrita(fecha, true)) && texto.includes(fechaEscrita(fecha2, true)) && texto.includes(interno))
      return { fecha: iso(fecha), monto: centavos / 100 };
  }
  return null;
}

export const sitioDe = (c: Comprobante | null | undefined) => SITIOS.find((s) => s.id === c?.sitio);

/** Mes que cubre el comprobante de la nota, o null si no tiene uno configurado. */
export function periodoDe(n: Nota) {
  const s = sitioDe(n.comprobante);
  return s ? s.periodo(parseIso(n.date)) : null;
}

/** Abre el sitio en una ventana de la app con el formulario completo para el período de `n`. */
export async function abrir(n: Nota) {
  const s = sitioDe(n.comprobante);
  if (!s || !n.comprobante) throw new Error("Sitio desconocido");
  const fecha = s.periodo(parseIso(n.date));
  const mes = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("comprobante_abrir", {
    notaId: n.id,
    url: s.url,
    pasos: s.pasos(n.comprobante.datos, fecha),
    captura: s.captura ?? "",
    instruccion: s.instruccion,
    nombre: `${n.title} ${mes}`,
    puertosTls: s.puertosTls ?? [],
  });
}

/** Avisa cuando llega el PDF de una descarga, con su texto (si se pudo extraer). */
export async function alRecibir(fn: (notaId: string, a: Adjunto, texto: string | null) => void) {
  const { listen } = await import("@tauri-apps/api/event");
  await listen<{ notaId: string; adjunto: Adjunto; texto: string | null }>("comprobante", ({ payload: p }) =>
    fn(p.notaId, p.adjunto, p.texto));
}
