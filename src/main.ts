import "@fontsource-variable/geist";
import "./styles.css";
import * as G from "./google";
import { abrirAdjunto, abrirLink, adjuntar, elegirArchivos, isTauri, load, save as persist } from "./store";
import {
  MES, type Enlace, type Frecuencia, type Nota, type Tema, type Urgencia,
  addDays, addMonths, cap, cuotaPar, fmtSize, normUrl, shortDate, urlCorta, esc, firstOfMonth, fmtAmountInput, iso, longDate, money, monthTitle,
  norm, parseAmount, parseIso, rel, today, urgencia, diffDays,
} from "./util";

// ---------- Íconos ----------
const svg = (size: number, sw: number, body: string, extra = 'stroke-linecap="round"') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="${sw}" ${extra}>${body}</svg>`;
const ICON = {
  calendarPlus: svg(24, 1, '<rect x="2.5" y="3.5" width="11" height="10" rx="2"/><line x1="2.5" y1="6.5" x2="13.5" y2="6.5"/><line x1="5.5" y1="2" x2="5.5" y2="4.5"/><line x1="10.5" y1="2" x2="10.5" y2="4.5"/><line x1="8" y1="8.5" x2="8" y2="11.5"/><line x1="6.5" y1="10" x2="9.5" y2="10"/>'),
  plus: svg(14, 1.6, '<line x1="8" y1="3.5" x2="8" y2="12.5"/><line x1="3.5" y1="8" x2="12.5" y2="8"/>'),
  x: svg(14, 1.5, '<line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>'),
  xs: svg(12, 1.6, '<line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>'),
  clip: svg(14, 1.4, '<path d="M13 7.6 8.2 12.4a3 3 0 0 1-4.3-4.3l5-5a2 2 0 0 1 2.9 2.9l-5 5a1 1 0 0 1-1.5-1.5L9.8 5"/>', 'stroke-linecap="round" stroke-linejoin="round"'),
  clipSm: svg(12, 1.5, '<path d="M13 7.6 8.2 12.4a3 3 0 0 1-4.3-4.3l5-5a2 2 0 0 1 2.9 2.9l-5 5a1 1 0 0 1-1.5-1.5L9.8 5"/>', 'stroke-linecap="round" stroke-linejoin="round"'),
  link: svg(14, 1.4, '<path d="M6.8 9.2a2.8 2.8 0 0 0 4 0l2-2a2.8 2.8 0 0 0-4-4l-.7.7"/><path d="M9.2 6.8a2.8 2.8 0 0 0-4 0l-2 2a2.8 2.8 0 0 0 4 4l.7-.7"/>', 'stroke-linecap="round" stroke-linejoin="round"'),
  linkLg: svg(16, 1.3, '<path d="M6.8 9.2a2.8 2.8 0 0 0 4 0l2-2a2.8 2.8 0 0 0-4-4l-.7.7"/><path d="M9.2 6.8a2.8 2.8 0 0 0-4 0l-2 2a2.8 2.8 0 0 0 4 4l.7-.7"/>', 'stroke-linecap="round" stroke-linejoin="round"'),
  file: svg(16, 1.3, '<path d="M9 1.8H4.5a1 1 0 0 0-1 1v10.4a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5.3z"/><polyline points="9,1.8 9,5.3 12.5,5.3"/>', 'stroke-linecap="round" stroke-linejoin="round"'),
  check: svg(12, 2.2, '<polyline points="3.5,8.5 6.5,11.5 12.5,4.5"/>', 'stroke-linecap="round" stroke-linejoin="round"'),
  chevRight: svg(12, 1.6, '<polyline points="6,4 10,8 6,12"/>', 'class="chev" stroke-linecap="round" stroke-linejoin="round"'),
  calPrev: svg(13, 1.6, '<polyline points="10,4 6,8 10,12"/>', 'stroke-linecap="round" stroke-linejoin="round"'),
  calNext: svg(13, 1.6, '<polyline points="6,4 10,8 6,12"/>', 'stroke-linecap="round" stroke-linejoin="round"'),
  trash: svg(14, 1.4, '<line x1="3" y1="4.5" x2="13" y2="4.5"/><path d="M4.8 4.5l.6 8.5h5.2l.6-8.5M6.5 4.5V3h3v1.5"/>', 'stroke-linecap="round" stroke-linejoin="round"'),
  sun: svg(15, 1.4, '<circle cx="8" cy="8" r="3"/><line x1="8" y1="1.5" x2="8" y2="2.8"/><line x1="8" y1="13.2" x2="8" y2="14.5"/><line x1="1.5" y1="8" x2="2.8" y2="8"/><line x1="13.2" y1="8" x2="14.5" y2="8"/><line x1="3.4" y1="3.4" x2="4.3" y2="4.3"/><line x1="11.7" y1="11.7" x2="12.6" y2="12.6"/><line x1="3.4" y1="12.6" x2="4.3" y2="11.7"/><line x1="11.7" y1="4.3" x2="12.6" y2="3.4"/>'),
  moon: svg(15, 1.4, '<path d="M13 9.6A5.5 5.5 0 1 1 6.4 3a4.4 4.4 0 0 0 6.6 6.6z"/>', 'stroke-linejoin="round"'),
};

// ---------- Estado ----------
/** "ninguna" = sin repetición (ningún chip elegido). */
type Repeticion = "ninguna" | "anual" | Frecuencia;
type Form = {
  id: string | null; title: string; date: string; amount: string; desc: string;
  freq: Repeticion;
  /** Total de cuotas de la serie y número de la cuota de esta fecha. */
  cuotas: number; desde: number;
  /** Mensual con monto que dura 2 meses. */
  par: boolean;
  /** true mientras el usuario no tocó los contadores: siguen a la fecha elegida. */
  auto: boolean;
  /** Links a copiar en la nota nueva (al repetir una nota). */
  links?: Enlace[];
};

const REPETICIONES: [Repeticion, string][] = [
  ["anual", "Anual"], ["mensual", "Mensual"], ["bimestral", "Bimestral"], ["cuotas", "En cuotas"],
];
const FREQ_LABEL: Record<Frecuencia, string> = { mensual: "Mensual", bimestral: "Bimestral", cuotas: "En cuotas" };
const CUOTAS_MAX = 60;

/** Contadores por defecto: mensual = mes de la fecha de 12, bimestral = bimestre de 6, cuotas = 1 de 3. */
function cuotasPorDefecto(freq: Repeticion, date: string) {
  const m = parseIso(date).getMonth();
  if (freq === "mensual") return { cuotas: 12, desde: m + 1 };
  if (freq === "bimestral") return { cuotas: 6, desde: Math.floor(m / 2) + 1 };
  return { cuotas: 3, desde: 1 };
}

const repeticionDe = (n: Nota): Repeticion => n.series?.freq ?? (n.anual ? "anual" : "ninguna");
/** Mensual, bimestral y cuotas generan varios vencimientos; ninguna y anual, uno solo. */
const esSerie = (r: Repeticion) => r !== "ninguna" && r !== "anual";

/** ¿El formulario pide una repetición distinta de la que tiene la nota? */
function repeticionCambia(f: Form, n: Nota) {
  if (f.freq !== repeticionDe(n)) return true;
  return esSerie(f.freq) &&
    (f.cuotas !== n.series?.total || f.desde !== n.series?.n || (f.freq === "mensual" && f.par !== (n.series?.par != null)));
}

/** Quita la nota `keepId` de su serie: borra las otras cuotas pendientes y deja sueltas las ya hechas. */
function desarmarSerie(notes: Nota[], serieId: string, keepId: string): Nota[] {
  return notes
    .filter((x) => x.id === keepId || x.series?.id !== serieId || x.done)
    .map((x) => (x.id !== keepId && x.series?.id === serieId ? { ...x, series: null } : x));
}

const fechasTxt = (ds: Date[]) =>
  ds.length > 4
    ? `${ds.slice(0, 3).map(shortDate).join(" · ")} … ${shortDate(ds[ds.length - 1])}`
    : ds.map(shortDate).join(" · ");

/** Fechas de los vencimientos que genera el formulario: desde la cuota actual hasta la última. */
function seriesDates(f: Form): Date[] {
  const start = parseIso(f.date);
  if (!esSerie(f.freq)) return [start];
  const step = f.freq === "bimestral" ? 2 : 1;
  return Array.from({ length: f.cuotas - f.desde + 1 }, (_, i) => addMonths(start, i * step));
}

const S = {
  notes: [] as Nota[],
  theme: "claro" as Tema,
  themeStored: false,
  query: "",
  doneOpen: false,
  panel: null as null | "form" | "detail" | "google",
  selId: null as string | null,
  form: null as Form | null,
  tried: false,
  confirm: false,
  /** Notas tildadas en la lista para sumar sus montos (no se guarda). */
  picked: new Set<string>(),
  /** Conexión con Google Calendar. */
  g: {
    estado: null as G.EstadoGoogle | null,
    calendarios: null as G.Calendario[] | null,
    eligiendo: false,
    /** Mensaje mientras se espera algo largo (autorizar en el navegador). */
    ocupado: null as string | null,
    error: null as string | null,
    ultimo: null as { fecha: Date; r: G.Resultado } | null,
    sincronizando: false,
    /** Ya se mostró el aviso de error de sincronización automática. */
    avisado: false,
  },
  /** Campo «Agregar link» abierto en el detalle. */
  addingLink: false,
  toast: null as null | { text: string; undo?: () => void },
  flash: [] as string[],
  cal: firstOfMonth(today()),
};

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const content = $("#content");
const panelRoot = $("#panel-root");
const toastRoot = $("#toast-root");
const selbarRoot = $("#selbar-root");
const searchInput = $<HTMLInputElement>("#search");

let flashTimer = 0;
let toastTimer = 0;

const commit = () => {
  persist({ notes: S.notes, theme: S.themeStored ? S.theme : null });
  scheduleSync();
};
const selected = () => S.notes.find((n) => n.id === S.selId);
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : "n" + Date.now() + Math.random().toString(36).slice(2));

// ---------- Tema y buscador ----------
function renderTheme() {
  document.documentElement.dataset.theme = S.theme;
  $("#theme").innerHTML = S.theme === "oscuro" ? ICON.sun : ICON.moon;
}

function renderSearch() {
  if (searchInput.value !== S.query) searchInput.value = S.query;
  $("#search-clear").hidden = !S.query;
  $("#search-kbd").hidden = !!S.query;
}

// ---------- Lista ----------
const badge = (kind: Urgencia, label: string) =>
  `<span class="badge ${kind === "red" || kind === "amber" ? kind : "plain"}">${esc(label)}</span>`;

type Item = { n: Nota; d: Date; dd: number; kind: Urgencia; label: string };

const clipCount = (n: Nota) => {
  const k = (n.files?.length ?? 0) + (n.links?.length ?? 0);
  return k ? `<span class="clip-count tab" title="${k} adjunto${k > 1 ? "s" : ""}">${ICON.clipSm}${k > 1 ? k : ""}</span>` : "";
};

const repChip = (n: Nota) =>
  n.series ? `<span class="rep-chip tab">Cuota ${n.series.n}/${n.series.total}</span>`
  : n.anual ? `<span class="rep-chip">Anual</span>`
  : "";

function rowHTML(x: Item) {
  const n = x.n;
  const cls = ["row"];
  if (n.done) cls.push("done");
  const picked = S.picked.has(n.id);
  if (picked) cls.push("picked");
  if (S.flash.includes(n.id)) cls.push("flash");
  else if (S.panel && S.selId === n.id) cls.push("sel");
  return `<div class="${cls.join(" ")}" data-id="${esc(n.id)}">
    <button class="cb${picked ? " on" : ""}" data-pick="${esc(n.id)}" role="checkbox" aria-checked="${picked}" aria-label="Seleccionar para sumar">${picked ? ICON.check : ""}</button>
    <div class="row-body">
      <div class="dateblk"><span class="day tab${x.kind === "red" ? " red" : ""}">${x.d.getDate()}</span><span class="mon">${MES[x.d.getMonth()]}</span></div>
      <div class="texts">
        <div class="title-line"><span class="title">${esc(n.title)}</span>${repChip(n)}${clipCount(n)}</div>
        ${n.desc ? `<div class="sub">${esc(n.desc.split("\n")[0])}</div>` : ""}
      </div>
      ${n.amount != null ? `<div class="amount tab">${money(n.amount)}</div>` : ""}
      <div class="badge-col">${badge(x.kind, x.label)}</div>
    </div>
  </div>`;
}

function renderList() {
  const t = today();
  const q = norm(S.query.trim());
  let html: string;

  if (S.notes.length === 0) {
    html = `<div class="empty">
      <div class="empty-icon">${ICON.calendarPlus}</div>
      <div class="empty-texts">
        <div class="empty-title">Tu agenda está vacía</div>
        <div class="empty-sub">Anotá vencimientos, pagos o trámites y los vas a ver ordenados por fecha.</div>
      </div>
      <button class="btn btn-primary btn-lg" data-new>${ICON.plus}Crear la primera nota</button>
      <div class="empty-hint">o presioná <span class="kbd">Ctrl N</span></div>
    </div>`;
  } else {
    const items: Item[] = S.notes
      .filter((n) => !q || norm(n.title + " " + n.desc).includes(q))
      .map((n) => ({ n, ...urgencia(n, t) }))
      .sort((a, b) => a.d.getTime() - b.d.getTime());

    if (items.length === 0) {
      html = `<div class="noresults">
        <div class="noresults-title">Sin resultados para “${esc(S.query.trim())}”</div>
        <div class="noresults-sub">Probá con otra palabra o revisá la ortografía.</div>
      </div>`;
    } else {
      const mismoMes = (d: Date) => d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth();
      const defs: [string, (x: Item) => boolean][] = [
        ["Vencidas", (x) => !x.n.done && x.dd < 0],
        ["Este mes", (x) => !x.n.done && x.dd >= 0 && mismoMes(x.d)],
        ["Próximas", (x) => !x.n.done && x.dd >= 0 && !mismoMes(x.d)],
        ["Hechas", (x) => x.n.done],
      ];
      html = defs
        .map(([name, f], i) => {
          let g = items.filter(f);
          if (!g.length) return "";
          const isDone = i === 3;
          if (isDone) g = g.reverse();
          const collapsible = isDone && !q;
          const open = !collapsible || S.doneOpen;
          return `<section class="group${collapsible ? " collapsible" : ""}${open ? " open" : ""}">
            <div class="group-h"${collapsible ? " data-collapse" : ""}>
              ${i === 0 ? '<span class="dot-red"></span>' : ""}
              <span>${name}</span><span class="count tab">${g.length}</span>
              ${collapsible ? ICON.chevRight : ""}
            </div>
            <div class="items">${g.map(rowHTML).join("")}</div>
          </section>`;
        })
        .join("");
    }
  }
  content.innerHTML = `<div class="column">${html}</div>`;
  renderSelbar();
}

content.addEventListener("click", (e) => {
  const el = e.target as HTMLElement;
  const pk = el.closest<HTMLElement>("[data-pick]");
  if (pk) return togglePick(pk.dataset.pick!);
  if (el.closest("[data-new]")) return openNew();
  const gh = el.closest<HTMLElement>("[data-collapse]");
  if (gh) {
    S.doneOpen = !S.doneOpen;
    gh.parentElement!.classList.toggle("open", S.doneOpen);
    return;
  }
  const row = el.closest<HTMLElement>(".row");
  if (row) openDetail(row.dataset.id!);
});

// ---------- Selección y total ----------
function togglePick(id: string) {
  if (!S.picked.delete(id)) S.picked.add(id);
  renderList();
}

function clearPicked() {
  S.picked.clear();
  renderList();
}

function renderSelbar() {
  // Las notas eliminadas salen de la selección.
  const sel = S.notes.filter((n) => S.picked.has(n.id));
  S.picked = new Set(sel.map((n) => n.id));
  document.querySelector(".app")!.classList.toggle("has-selbar", sel.length > 0);
  if (!sel.length) {
    selbarRoot.innerHTML = "";
    return;
  }
  const total = sel.reduce((acc, n) => acc + (n.amount ?? 0), 0);
  const sinMonto = sel.filter((n) => n.amount == null).length;
  selbarRoot.innerHTML = `<div class="selbar" role="status">
    <div class="selbar-in">
      <span class="selbar-count">${sel.length === 1 ? "1 seleccionada" : `${sel.length} seleccionadas`}${sinMonto ? `<span class="selbar-note"> · ${sinMonto} sin monto</span>` : ""}</span>
      <span class="selbar-total"><span class="selbar-lbl">Total</span><span class="tab">${money(total)}</span></span>
      <button class="btn btn-ghost" data-clear-picked>Limpiar</button>
    </div>
  </div>`;
}
selbarRoot.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("[data-clear-picked]")) clearPicked();
});

// ---------- Panel ----------
function renderPanel() {
  if (!S.panel) {
    panelRoot.innerHTML = "";
    return;
  }
  const body = S.panel === "form" ? formHTML() : S.panel === "google" ? googleHTML() : detailHTML();
  if (!body) {
    panelRoot.innerHTML = "";
    return;
  }
  panelRoot.innerHTML = `<div class="scrim" data-act="close"></div><aside class="panel">${body}</aside>`;
  if (S.panel === "form") bindForm();
}

function formHTML() {
  const f = S.form!;
  const err = S.tried && !f.title.trim();
  const repeticion = `<div class="field">
        <span class="lbl">Repetición</span>
        <div id="f-rep"></div>
      </div>`;
  return `
    <div class="panel-h">
      <h2>${f.id ? "Editar nota" : "Nueva nota"}</h2>
      <button class="icon-btn" data-act="cancel" aria-label="Cerrar">${ICON.x}</button>
    </div>
    <div class="panel-b">
      <div class="field">
        <label class="lbl" for="f-title">Título</label>
        <input id="f-title" class="input${err ? " err" : ""}" value="${esc(f.title)}" placeholder="Ej. Vencimiento IVA – Septiembre" autocomplete="off" />
        <span id="f-err" class="errmsg"${err ? "" : " hidden"}>Escribí un título para la nota.</span>
      </div>
      <div class="field date">
        <div class="lbl-row"><span class="lbl">Fecha</span><span id="f-date-val" class="date-val"></span></div>
        <div id="f-dates"></div>
      </div>
      ${repeticion}
      <div class="field">
        <div class="lbl-row"><label id="f-amount-lbl" class="lbl" for="f-amount">Monto</label><span class="opt">Opcional</span></div>
        <div class="money">
          <span class="cur">$</span>
          <input id="f-amount" inputmode="decimal" placeholder="0,00" value="${esc(f.amount)}" autocomplete="off" />
          <span class="ars">ARS</span>
        </div>
      </div>
      <div class="field">
        <div class="lbl-row"><label class="lbl" for="f-desc">Descripción</label><span class="opt">Opcional</span></div>
        <textarea id="f-desc" class="textarea" rows="3" placeholder="Cómo pagar, número de cuenta, recordatorios…">${esc(f.desc)}</textarea>
      </div>
      ${!f.id && f.links?.length ? `<span class="hint">${ICON.link} También se copia${f.links.length > 1 ? `n ${f.links.length} links` : " 1 link"}: ${f.links.map((l) => esc(urlCorta(l.url))).join(", ")}</span>` : ""}
    </div>
    <div class="panel-f">
      <span class="hint">Ctrl ↵ para guardar</span>
      <div class="btns">
        <button class="btn btn-ghost" data-act="cancel">Cancelar</button>
        <button id="f-save" class="btn btn-primary" data-act="save">${f.id ? "Guardar cambios" : "Guardar"}</button>
      </div>
    </div>`;
}

function renderDates() {
  const f = S.form!;
  const t = today();
  const fd = parseIso(f.date);
  $("#f-date-val", panelRoot).textContent = `${cap(longDate(fd))} · ${rel(diffDays(fd, t))}`;

  const quick: [string, Date][] = [
    ["Hoy", t],
    ["Mañana", addDays(t, 1)],
    ["En una semana", addDays(t, 7)],
    ["Fin de mes", new Date(t.getFullYear(), t.getMonth() + 1, 0)],
  ];
  const chips = quick
    .map(([label, d]) => `<button class="chip${iso(d) === f.date ? " on" : ""}" data-date="${iso(d)}">${label}</button>`)
    .join("");

  const y = S.cal.getFullYear(), m = S.cal.getMonth();
  const offset = (new Date(y, m, 1).getDay() + 6) % 7; // semana empieza en lunes
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const rows = Math.ceil((offset + daysInMonth) / 7);
  const start = addDays(new Date(y, m, 1), -offset);
  const todayIso = iso(t);
  let cells = "";
  for (let i = 0; i < rows * 7; i++) {
    const d = addDays(start, i), di = iso(d);
    const cls = ["cell"];
    if (d.getMonth() !== m) cls.push("out");
    if (di === f.date) cls.push("sel");
    else if (di === todayIso) cls.push("today");
    cells += `<button class="${cls.join(" ")}" data-date="${di}">${d.getDate()}</button>`;
  }

  $("#f-dates", panelRoot).innerHTML = `
    <div class="chips">${chips}</div>
    <div class="cal" style="margin-top:8px">
      <div class="cal-h">
        <span>${monthTitle(S.cal)}</span>
        <div class="cal-nav">
          <button data-cal="-1" aria-label="Mes anterior">${ICON.calPrev}</button>
          <button data-cal="1" aria-label="Mes siguiente">${ICON.calNext}</button>
        </div>
      </div>
      <div class="cal-grid">
        ${["L", "M", "M", "J", "V", "S", "D"].map((w) => `<span class="wd">${w}</span>`).join("")}
        ${cells}
      </div>
    </div>`;
}

function renderRepeat() {
  const f = S.form!;
  const box = panelRoot.querySelector<HTMLElement>("#f-rep");
  if (!box) return;
  const dates = seriesDates(f);
  const chips = REPETICIONES
    .map(([k, label]) => `<button class="chip${f.freq === k ? " on" : ""}" data-freq="${k}">${label}</button>`)
    .join("");
  const stepperRow = (label: string, key: string, val: number, min: number, max: number) =>
    `<div class="stepper-row">
      <span class="lbl">${label}</span>
      <div class="stepper">
        <button data-${key}="-1" aria-label="${label}: menos"${val <= min ? " disabled" : ""}>−</button>
        <span class="tab">${val}</span>
        <button data-${key}="1" aria-label="${label}: más"${val >= max ? " disabled" : ""}>+</button>
      </div>
    </div>`;
  const stepper = esSerie(f.freq)
    ? stepperRow("Cuota actual", "desde", f.desde, 1, f.cuotas) + stepperRow("Total de cuotas", "cuotas", f.cuotas, 1, CUOTAS_MAX)
    : "";
  const parBox = f.freq === "mensual"
    ? `<button class="check-row" data-par>
        <span class="cb${f.par ? " on" : ""}">${f.par ? ICON.check : ""}</span>El monto dura 2 meses
      </button>`
    : "";

  let texto = "";
  const original = f.id ? S.notes.find((n) => n.id === f.id) : null;
  if (!original) {
    if (esSerie(f.freq))
      texto = dates.length === 1
        ? `Se crea solo la cuota ${f.desde} de ${f.cuotas}: ${fechasTxt(dates)}`
        : `Se crean ${dates.length} vencimientos (cuotas ${f.desde} a ${f.cuotas}): ${fechasTxt(dates)}`;
  } else if (!repeticionCambia(f, original)) {
    if (original.series) {
      const par = cuotaPar(original.series);
      const socio = par == null ? null : S.notes.find((x) => x.series?.id === original.series!.id && x.series.n === par && !x.done);
      texto = `Cuota ${original.series.n} de ${original.series.total}. ` + (socio
        ? `El monto se copia también a su par, la cuota ${par} (${shortDate(parseIso(socio.date))}).`
        : "Solo se modifica esta cuota.");
    }
  } else {
    const otras = original.series ? S.notes.filter((x) => x.series?.id === original.series!.id && x.id !== original.id) : [];
    const pend = otras.filter((x) => !x.done).length;
    const hechas = otras.length - pend;
    const partes: string[] = [];
    if (pend) partes.push(pend === 1 ? "Se elimina la otra cuota pendiente." : `Se eliminan las otras ${pend} cuotas pendientes.`);
    if (hechas) partes.push(hechas === 1 ? "La cuota ya hecha queda como nota suelta." : `Las ${hechas} cuotas ya hechas quedan como notas sueltas.`);
    if (f.freq === "anual") partes.push("Esta nota queda como vencimiento anual.");
    else if (f.freq === "ninguna") partes.push(original.series ? "Esta nota queda sin repetición." : "");
    else if (dates.length === 1) partes.push(`Esta pasa a ser la cuota ${f.desde} de ${f.cuotas}, la última.`);
    else {
      const resto = dates.slice(1);
      partes.push(`Esta pasa a ser la cuota ${f.desde} de ${f.cuotas} y se ${resto.length === 1 ? "crea 1 más" : `crean ${resto.length} más`}: ${fechasTxt(resto)}`);
    }
    texto = partes.filter(Boolean).join(" ");
  }
  const rearma = !original || repeticionCambia(f, original);
  if (rearma && f.freq === "mensual" && f.par && dates.length > 2)
    texto += `${texto.endsWith(".") ? "" : "."} El monto se carga en las cuotas ${f.desde} y ${f.desde + 1}; las demás quedan sin monto.`;
  const preview = texto ? `<div class="rep-preview">${texto}</div>` : "";
  box.innerHTML = `<div class="chips">${chips}</div>${stepper}${parBox}${preview}`;
  const lbl = panelRoot.querySelector("#f-amount-lbl");
  if (lbl) lbl.textContent = esSerie(f.freq) ? "Monto por cuota" : "Monto";
}

function updateSaveState() {
  const f = S.form!;
  const err = S.tried && !f.title.trim();
  $("#f-save", panelRoot).style.opacity = f.title.trim() ? "1" : ".5";
  $("#f-title", panelRoot).classList.toggle("err", err);
  $("#f-err", panelRoot).hidden = !err;
}

function bindForm() {
  const title = $<HTMLInputElement>("#f-title", panelRoot);
  const amount = $<HTMLInputElement>("#f-amount", panelRoot);
  const desc = $<HTMLTextAreaElement>("#f-desc", panelRoot);
  title.addEventListener("input", () => {
    S.form!.title = title.value;
    updateSaveState();
  });
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      save();
    }
  });
  amount.addEventListener("input", () => (S.form!.amount = amount.value));
  amount.addEventListener("blur", () => {
    if (!S.form) return;
    S.form.amount = fmtAmountInput(parseAmount(amount.value));
    amount.value = S.form.amount;
  });
  desc.addEventListener("input", () => (S.form!.desc = desc.value));
  renderDates();
  renderRepeat();
  updateSaveState();
}

function detailHTML() {
  const n = selected();
  if (!n) return "";
  const x = urgencia(n, today());
  const meta =
    x.kind === "red" || x.kind === "amber" ? badge(x.kind, x.label) : `<span class="rel">· ${esc(x.label)}</span>`;
  const footer = S.confirm && n.series
    ? `<div class="panel-f confirm">
        <span class="confirm-q">¿Eliminar?</span>
        <div class="btns tight">
          <button class="btn btn-plain" data-act="cancel-delete">Cancelar</button>
          <button class="btn btn-red-outline" data-act="delete">Solo esta</button>
          <button class="btn btn-red" data-act="delete-series">Toda la serie</button>
        </div>
      </div>`
    : S.confirm
    ? `<div class="panel-f confirm">
        <span class="confirm-q">¿Eliminar esta nota?</span>
        <div class="btns">
          <button class="btn btn-plain" data-act="cancel-delete">Cancelar</button>
          <button class="btn btn-red" data-act="delete">Eliminar</button>
        </div>
      </div>`
    : `<div class="panel-f">
        <button class="btn btn-danger" data-act="ask-delete">${ICON.trash}Eliminar</button>
        <div class="btns">
          <button class="btn btn-secondary" data-act="repeat" title="Crear una nota nueva con estos datos">Repetir</button>
          <button class="btn btn-secondary" data-act="edit">Editar</button>
        </div>
      </div>`;
  return `
    <div class="panel-h detail">
      <button class="done-toggle" data-act="toggle">
        <span class="cb${n.done ? " on" : ""}">${n.done ? ICON.check : ""}</span>
        ${n.done ? "Hecha" : "Marcar como hecha"}
      </button>
      <button class="icon-btn" data-act="close" aria-label="Cerrar">${ICON.x}</button>
    </div>
    <div class="panel-b detail">
      <div class="d-head">
        <div class="d-date"><span class="d-day tab${x.kind === "red" ? " red" : ""}">${x.d.getDate()}</span><span class="d-mon">${MES[x.d.getMonth()]}</span></div>
        <div class="d-info">
          <div class="d-title${n.done ? " done" : ""}">${esc(n.title)}</div>
          <div class="d-meta"><span>${cap(longDate(x.d))} de ${x.d.getFullYear()}</span>${meta}</div>
          ${n.series ? `<div class="d-serie tab">Cuota ${n.series.n} de ${n.series.total} · ${FREQ_LABEL[n.series.freq] ?? ""}${n.series.par != null ? " · monto bimestral" : ""}</div>`
            : n.anual ? `<div class="d-serie">Anual</div>` : ""}
        </div>
      </div>
      <div class="sep"></div>
      <div class="field">
        <span class="d-k">Monto</span>
        ${n.amount != null ? `<span class="d-amount tab">${money(n.amount)}</span>` : '<span class="d-none">Sin monto</span>'}
      </div>
      <div class="field">
        <span class="d-k">Descripción</span>
        ${n.desc ? `<div class="d-desc">${esc(n.desc)}</div>` : '<span class="d-none">Sin descripción</span>'}
      </div>
      <div class="field">
        <span class="d-k">Adjuntos</span>
        ${(n.files ?? []).map((a) => `<div class="file" data-open-file="${esc(a.id)}" title="Abrir ${esc(a.name)}">
            <span class="file-ico">${ICON.file}</span>
            <span class="file-name">${esc(a.name)}</span>
            <span class="file-size tab">${fmtSize(a.size)}</span>
            <button class="file-x" data-remove-file="${esc(a.id)}" aria-label="Quitar ${esc(a.name)}">${ICON.xs}</button>
          </div>`).join("")}
        ${(n.links ?? []).map((l) => `<div class="file" data-open-link="${esc(l.id)}" title="${esc(l.url)}">
            <span class="file-ico">${ICON.linkLg}</span>
            <span class="file-name link-name">${esc(urlCorta(l.url))}</span>
            <button class="file-x" data-remove-link="${esc(l.id)}" aria-label="Quitar link">${ICON.xs}</button>
          </div>`).join("")}
        ${S.addingLink
          ? `<div class="link-add">
              <input id="link-input" class="input" placeholder="Pegá un link: https://…" autocomplete="off" spellcheck="false" />
              <button class="btn btn-primary" data-act="link-save">Agregar</button>
            </div>
            <span id="link-err" class="errmsg" hidden>Ese link no es válido.</span>
            ${n.series ? `<span class="hint">Se agrega a las ${serieDeNota(n).length} cuotas de la serie.</span>` : ""}`
          : `<div class="attach-row">
              ${isTauri ? `<button class="btn btn-ghost btn-attach" data-act="attach" title="También podés arrastrar archivos a este panel">${ICON.clip}Adjuntar archivo</button>` : ""}
              <button class="btn btn-ghost btn-attach" data-act="link-add"${n.series ? ' title="Se agrega a todas las cuotas"' : ""}>${ICON.link}Agregar link</button>
            </div>`}
      </div>
    </div>
    ${footer}`;
}

panelRoot.addEventListener("click", (e) => {
  const el = e.target as HTMLElement;
  const calId = el.closest<HTMLElement>("[data-cal-id]");
  if (calId) return void elegirCalendarioGoogle(calId.dataset.calId!);
  const rm = el.closest<HTMLElement>("[data-remove-file]");
  if (rm) return removeFile(rm.dataset.removeFile!);
  const rl = el.closest<HTMLElement>("[data-remove-link]");
  if (rl) return removeLink(rl.dataset.removeLink!);
  const ol = el.closest<HTMLElement>("[data-open-link]");
  if (ol) {
    const l = selected()?.links?.find((x) => x.id === ol.dataset.openLink);
    if (l) abrirLink(l.url).catch((err) => {
      console.error(err);
      showToast("No se pudo abrir el link");
    });
    return;
  }
  const of = el.closest<HTMLElement>("[data-open-file]");
  if (of) {
    abrirAdjunto(of.dataset.openFile!).catch((err) => {
      console.error(err);
      showToast(String(err).includes("ya no existe") ? "El archivo ya no existe" : "No se pudo abrir el archivo");
    });
    return;
  }
  const dateBtn = el.closest<HTMLElement>("[data-date]");
  if (dateBtn && S.form) {
    S.form.date = dateBtn.dataset.date!;
    S.cal = firstOfMonth(parseIso(S.form.date));
    if (S.form.auto && esSerie(S.form.freq)) Object.assign(S.form, cuotasPorDefecto(S.form.freq, S.form.date));
    renderDates();
    return renderRepeat();
  }
  const freqBtn = el.closest<HTMLElement>("[data-freq]");
  if (freqBtn && S.form) {
    const elegida = freqBtn.dataset.freq as Repeticion;
    // Volver a tocar la repetición activa la deselecciona: queda sin repetición.
    const f = S.form;
    f.freq = elegida === f.freq ? "ninguna" : elegida;
    if (esSerie(f.freq)) {
      // Volver a la repetición que ya tenía la nota recupera sus números; si no, se usan los de la fecha.
      const serie = f.id ? S.notes.find((n) => n.id === f.id)?.series : null;
      if (serie && serie.freq === f.freq) Object.assign(f, { cuotas: serie.total, desde: serie.n, par: serie.par != null, auto: false });
      else Object.assign(f, cuotasPorDefecto(f.freq, f.date), { par: false, auto: true });
    }
    return renderRepeat();
  }
  const cuotasBtn = el.closest<HTMLElement>("[data-cuotas]");
  if (cuotasBtn && S.form) {
    const f = S.form;
    f.cuotas = Math.min(CUOTAS_MAX, Math.max(1, f.cuotas + Number(cuotasBtn.dataset.cuotas)));
    f.desde = Math.min(f.desde, f.cuotas);
    f.auto = false;
    return renderRepeat();
  }
  if (el.closest("[data-par]") && S.form) {
    S.form.par = !S.form.par;
    return renderRepeat();
  }
  const desdeBtn = el.closest<HTMLElement>("[data-desde]");
  if (desdeBtn && S.form) {
    const f = S.form;
    f.desde = Math.min(f.cuotas, Math.max(1, f.desde + Number(desdeBtn.dataset.desde)));
    f.auto = false;
    return renderRepeat();
  }
  const calBtn = el.closest<HTMLElement>("[data-cal]");
  if (calBtn) {
    S.cal = new Date(S.cal.getFullYear(), S.cal.getMonth() + Number(calBtn.dataset.cal), 1);
    return renderDates();
  }
  const act = el.closest<HTMLElement>("[data-act]")?.dataset.act;
  switch (act) {
    case "close": return close();
    case "cancel": return cancelForm();
    case "save": return save();
    case "toggle": return S.selId && toggleDone(S.selId);
    case "edit": return edit();
    case "ask-delete": S.confirm = true; return renderPanel();
    case "cancel-delete": S.confirm = false; return renderPanel();
    case "delete": return del(false);
    case "delete-series": return del(true);
    case "repeat": return repeatNote();
    case "g-cred": case "g-conectar": case "g-cambiar": case "g-volver": case "g-sync": case "g-desconectar":
      return void accionGoogle(act);
    case "link-add": S.addingLink = true; renderPanel(); return panelRoot.querySelector<HTMLInputElement>("#link-input")?.focus();
    case "link-save": return saveLink();
    case "attach": return void elegirArchivos().then(attach).catch((err) => console.error(err));
  }
});

// ---------- Toast ----------
function renderToast() {
  toastRoot.innerHTML = S.toast
    ? `<div class="toast${S.toast.undo ? "" : " solo"}" role="status">${esc(S.toast.text)}${S.toast.undo ? "<button data-undo>Deshacer</button>" : ""}</div>`
    : "";
}
toastRoot.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("[data-undo]")) undo();
});

// ---------- Acciones ----------
function focusTitle() {
  const el = panelRoot.querySelector<HTMLInputElement>("#f-title");
  if (!el) return;
  el.focus();
  el.setSelectionRange(el.value.length, el.value.length);
}

function openNew() {
  const t = today();
  Object.assign(S, {
    panel: "form", selId: null, confirm: false, tried: false,
    form: { id: null, title: "", date: iso(t), amount: "", desc: "", freq: "ninguna", cuotas: 3, desde: 1, par: false, auto: true },
    cal: firstOfMonth(t),
  });
  renderPanel();
  renderList();
  focusTitle();
}

/** Abre «Nueva nota» con los datos de la nota abierta y la fecha del mes (o año, si es anual) siguiente. */
function repeatNote() {
  const n = selected();
  if (!n) return;
  const sig = n.anual ? addMonths(parseIso(n.date), 12) : addMonths(parseIso(n.date), 1);
  Object.assign(S, {
    panel: "form", selId: null, confirm: false, tried: false, addingLink: false,
    form: {
      id: null, title: n.title, date: iso(sig), amount: fmtAmountInput(n.amount), desc: n.desc,
      freq: n.anual ? "anual" : "ninguna", cuotas: 3, desde: 1, par: false, auto: true,
      links: n.links?.length ? n.links : undefined,
    },
    cal: firstOfMonth(sig),
  });
  renderPanel();
  renderList();
  focusTitle();
}

function openDetail(id: string) {
  Object.assign(S, { panel: "detail", selId: id, confirm: false, form: null, tried: false, addingLink: false });
  renderPanel();
  renderList();
}

function close() {
  Object.assign(S, { panel: null, selId: null, confirm: false, form: null, tried: false, addingLink: false });
  renderPanel();
  renderList();
}

function cancelForm() {
  if (S.panel === "form" && S.form?.id) {
    Object.assign(S, { panel: "detail", form: null, tried: false });
    renderPanel();
  } else close();
}

const formDeNota = (n: Nota): Form => ({
  id: n.id, title: n.title, date: n.date, amount: fmtAmountInput(n.amount), desc: n.desc,
  freq: repeticionDe(n), cuotas: n.series?.total ?? 3, desde: n.series?.n ?? 1, par: n.series?.par != null, auto: !n.series,
});

function edit() {
  const n = selected();
  if (!n) return;
  Object.assign(S, {
    panel: "form", confirm: false, tried: false,
    form: formDeNota(n),
    cal: firstOfMonth(parseIso(n.date)),
  });
  renderPanel();
  focusTitle();
}

function save() {
  const f = S.form;
  if (!f) return;
  if (!f.title.trim()) {
    S.tried = true;
    updateSaveState();
    $("#f-title", panelRoot).focus();
    return;
  }
  const data = { title: f.title.trim(), date: f.date, amount: parseAmount(f.amount), desc: f.desc.trim() };
  const original = f.id ? S.notes.find((n) => n.id === f.id) : null;
  // Si cambia la repetición, la nota editada pasa a ser la cuota 1 (o queda suelta) y se crean las siguientes.
  const cambiaRep = !original || repeticionCambia(f, original);
  const dates = cambiaRep ? seriesDates(f) : [];
  const serieId = cambiaRep && esSerie(f.freq) ? newId() : null;
  const conPar = f.freq === "mensual" && f.par;
  const serieDe = (i: number) =>
    serieId ? { id: serieId, n: f.desde + i, total: f.cuotas, freq: f.freq as Frecuencia, par: conPar ? f.desde % 2 : null } : null;
  // Con monto de a pares, solo la cuota actual y la siguiente llevan el monto cargado.
  const nuevas: Nota[] = dates.slice(original ? 1 : 0).map((d, j) => {
    const i = original ? j + 1 : j;
    return {
      id: newId(), done: false, ...data, date: iso(d), series: serieDe(i), anual: f.freq === "anual",
      amount: conPar && i > 1 ? null : data.amount,
      // Los links de la nota convertida pasan a todas las cuotas; los archivos quedan en ella.
      links: original?.links ? [...original.links] : f.links ? f.links.map((l) => ({ ...l, id: newId() })) : [],
    };
  });

  if (original) {
    if (original.series && cambiaRep) S.notes = desarmarSerie(S.notes, original.series.id, original.id);
    S.notes = S.notes.map((n) =>
      n.id === original.id ? { ...n, ...data, ...(cambiaRep ? { series: serieDe(0), anual: f.freq === "anual" } : {}) } : n);
    // Sin rearmar la serie: el monto nuevo se copia a la otra cuota del par, si sigue pendiente.
    const par = !cambiaRep && original.series ? cuotaPar(original.series) : null;
    if (par != null && data.amount !== original.amount) {
      S.notes = S.notes.map((n) =>
        n.series?.id === original.series!.id && n.series.n === par && !n.done ? { ...n, amount: data.amount } : n);
    }
  }
  S.notes = [...S.notes, ...nuevas];
  commit();

  if (original) {
    Object.assign(S, { panel: "detail", form: null, tried: false, flash: nuevas.map((n) => n.id) });
    renderPanel();
    renderList();
  } else {
    Object.assign(S, { panel: null, form: null, tried: false, query: "", flash: nuevas.map((n) => n.id) });
    renderSearch();
    renderPanel();
    renderList();
    content.querySelector(`.row[data-id="${CSS.escape(nuevas[0].id)}"]`)?.scrollIntoView({ block: "nearest" });
  }
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => {
    S.flash = [];
    content.querySelectorAll(".row.flash").forEach((r) => r.classList.remove("flash"));
  }, 1800);
}

function toggleDone(id: string) {
  S.notes = S.notes.map((n) => (n.id === id ? { ...n, done: !n.done } : n));
  commit();
  renderList();
  if (S.panel === "detail" && S.selId === id) renderPanel();
}

function del(serieCompleta: boolean) {
  const n = selected();
  if (!n) return;
  const sid = serieCompleta ? n.series?.id : null;
  const borrar = S.notes.filter((x) => x.id === n.id || (sid && x.series?.id === sid));
  const posiciones = borrar.map((note) => ({ note, idx: S.notes.indexOf(note) }));
  S.notes = S.notes.filter((x) => !borrar.includes(x));
  commit();
  close();
  showToast(borrar.length > 1 ? `${borrar.length} notas eliminadas` : "Nota eliminada", () => {
    const a = S.notes.slice();
    // Índices del arreglo original: reinsertar en orden ascendente los deja en su lugar.
    for (const { note, idx } of posiciones.sort((x, y) => x.idx - y.idx)) a.splice(idx, 0, note);
    S.notes = a;
  });
}

function showToast(text: string, undo?: () => void) {
  S.toast = { text, undo };
  renderToast();
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    S.toast = null;
    renderToast();
  }, 5000);
}

function undo() {
  const t = S.toast;
  if (!t?.undo) return;
  t.undo();
  S.toast = null;
  clearTimeout(toastTimer);
  commit();
  renderToast();
  renderList();
  if (S.panel === "detail") renderPanel();
}

// ---------- Adjuntos ----------
function setFiles(id: string, files: (prev: NonNullable<Nota["files"]>) => Nota["files"]) {
  S.notes = S.notes.map((n) => (n.id === id ? { ...n, files: files(n.files ?? []) } : n));
}

async function attach(paths: string[]) {
  const id = S.selId;
  if (!id || !paths.length) return;
  try {
    const nuevos = await adjuntar(paths);
    setFiles(id, (prev) => [...prev, ...nuevos]);
    commit();
    renderList();
    if (S.panel === "detail" && S.selId === id) renderPanel();
  } catch (e) {
    console.error(e);
    showToast("No se pudo adjuntar el archivo");
  }
}

function removeFile(fileId: string) {
  const n = selected();
  const a = n?.files?.find((f) => f.id === fileId);
  if (!n || !a) return;
  const idx = n.files!.indexOf(a);
  setFiles(n.id, (prev) => prev.filter((f) => f.id !== fileId));
  commit();
  renderPanel();
  renderList();
  // La copia en disco se borra recién al reiniciar la app, así «Deshacer» puede recuperarla.
  showToast("Adjunto quitado", () => setFiles(n.id, (prev) => [...prev.slice(0, idx), a, ...prev.slice(idx)]));
}

function setLinks(id: string, links: (prev: NonNullable<Nota["links"]>) => Nota["links"]) {
  S.notes = S.notes.map((n) => (n.id === id ? { ...n, links: links(n.links ?? []) } : n));
}

function saveLink() {
  const n = selected();
  const input = panelRoot.querySelector<HTMLInputElement>("#link-input");
  if (!n || !input) return;
  const url = normUrl(input.value);
  if (!url) {
    input.classList.add("err");
    $("#link-err", panelRoot).hidden = false;
    return input.focus();
  }
  const link = { id: newId(), url };
  for (const id of serieDeNota(n)) setLinks(id, (prev) => [...prev, link]);
  commit();
  S.addingLink = false;
  renderPanel();
  renderList();
}

/** Ids de las notas que comparten links con `n`: toda su serie, o solo ella si no repite. */
function serieDeNota(n: Nota) {
  return n.series ? S.notes.filter((x) => x.series?.id === n.series!.id).map((x) => x.id) : [n.id];
}

function removeLink(linkId: string) {
  const n = selected();
  if (!n?.links?.some((x) => x.id === linkId)) return;
  const quitados = S.notes
    .filter((x) => serieDeNota(n).includes(x.id))
    .flatMap((x) => {
      const idx = x.links?.findIndex((l) => l.id === linkId) ?? -1;
      return idx < 0 ? [] : [{ id: x.id, idx, link: x.links![idx] }];
    });
  for (const q of quitados) setLinks(q.id, (prev) => prev.filter((x) => x.id !== linkId));
  commit();
  renderPanel();
  renderList();
  showToast(quitados.length > 1 ? "Link quitado de todas las cuotas" : "Link quitado", () => {
    for (const q of quitados) setLinks(q.id, (prev) => [...prev.slice(0, q.idx), q.link, ...prev.slice(q.idx)]);
  });
}

// Enter agrega el link; Esc cierra el campo sin cerrar el panel.
panelRoot.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).id !== "link-input") return;
  if (e.key === "Enter") {
    e.preventDefault();
    saveLink();
  } else if (e.key === "Escape") {
    e.stopPropagation();
    S.addingLink = false;
    renderPanel();
  }
});
panelRoot.addEventListener("input", (e) => {
  const t = e.target as HTMLElement;
  if (t.id !== "link-input" || !t.classList.contains("err")) return;
  t.classList.remove("err");
  $("#link-err", panelRoot).hidden = true;
});

// ---------- Google Calendar ----------
const googleListo = () => isTauri && !!S.g.estado?.conectado && !!S.g.estado?.calendario;
let syncTimer = 0;
let syncPendiente = false;

function scheduleSync() {
  if (!googleListo()) return;
  clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => syncGoogle(), 2500);
}

async function syncGoogle(manual = false) {
  if (!googleListo()) return;
  if (S.g.sincronizando) {
    syncPendiente = true;
    return;
  }
  S.g.sincronizando = true;
  renderGoogle();
  try {
    S.g.ultimo = { fecha: new Date(), r: await G.sincronizar(S.notes) };
    S.g.error = null;
    S.g.avisado = false;
  } catch (e) {
    S.g.error = String(e);
    if (!manual && !S.g.avisado) {
      S.g.avisado = true;
      showToast("No se pudo sincronizar con Google Calendar");
    }
    if (S.g.error.includes("Volvé a conectar")) await refrescarGoogle();
  } finally {
    S.g.sincronizando = false;
    renderGoogle();
    if (syncPendiente) {
      syncPendiente = false;
      scheduleSync();
    }
  }
}

async function refrescarGoogle() {
  try {
    S.g.estado = await G.estado();
  } catch (e) {
    S.g.error = String(e);
  }
  renderGoogle();
}

async function cargarCalendarios() {
  S.g.calendarios = null;
  renderGoogle();
  try {
    S.g.calendarios = await G.calendarios();
  } catch (e) {
    S.g.error = String(e);
    S.g.calendarios = [];
  }
  renderGoogle();
}

/** Punto de estado en la barra superior y, si está abierto, el panel. */
function renderGoogle() {
  const btn = $("#google");
  btn.classList.toggle("ok", googleListo() && !S.g.error);
  btn.classList.toggle("err", !!S.g.error && !!S.g.estado?.conectado);
  if (S.panel === "google") renderPanel();
}

function openGoogle() {
  Object.assign(S, { panel: "google", selId: null, confirm: false, form: null, tried: false, addingLink: false });
  renderPanel();
  renderList();
  if (S.g.estado?.conectado && !S.g.estado.calendario && !S.g.calendarios) cargarCalendarios();
}

function googleHTML() {
  const g = S.g;
  const e = g.estado;
  const pasos = [
    {
      titulo: "Cargar credenciales",
      hecho: !!e?.credenciales,
      cuerpo: `<p class="g-txt">Elegí el archivo JSON del cliente OAuth (tipo «App de escritorio») que descargaste de Google Cloud. Los pasos están en el README del proyecto.</p>
        <button class="btn btn-primary" data-act="g-cred">Elegir archivo JSON…</button>`,
    },
    {
      titulo: "Conectar tu cuenta",
      hecho: !!e?.conectado,
      cuerpo: g.ocupado
        ? `<p class="g-txt g-wait">${esc(g.ocupado)}</p>`
        : `<p class="g-txt">Se abre el navegador para que autorices a Notes a crear eventos en tu calendario.</p>
          <button class="btn btn-primary" data-act="g-conectar">Conectar con Google</button>`,
    },
    {
      titulo: "Elegir calendario",
      hecho: !!e?.calendario && !g.eligiendo,
      cuerpo: g.calendarios == null
        ? `<p class="g-txt g-wait">Cargando tus calendarios…</p>`
        : g.calendarios.length === 0
          ? `<p class="g-txt">No se encontraron calendarios donde puedas crear eventos.</p>`
          : `<div class="g-cals">${g.calendarios.map((c) => `<button class="g-cal${e?.calendario?.id === c.id ? " on" : ""}" data-cal-id="${esc(c.id)}">
              <span class="g-cal-name">${esc(c.nombre)}</span>${c.principal ? '<span class="g-cal-tag">principal</span>' : ""}</button>`).join("")}</div>
            ${e?.calendario ? '<button class="btn btn-ghost g-back" data-act="g-volver">Cancelar</button>' : ""}`,
    },
  ];
  const actual = pasos.findIndex((p) => !p.hecho);
  let cuerpo: string;
  if (!isTauri) cuerpo = `<p class="g-txt">Disponible en la app de escritorio.</p>`;
  else if (!e) cuerpo = `<p class="g-txt g-wait">Cargando…</p>`;
  else if (actual >= 0) {
    cuerpo = `<ol class="g-pasos">${pasos.map((p, i) => `<li class="g-paso${p.hecho ? " hecho" : i === actual ? " actual" : ""}">
        <span class="g-num">${p.hecho ? ICON.check : i + 1}</span>
        <div class="g-paso-in"><div class="g-tit">${p.titulo}</div>${i === actual ? p.cuerpo : ""}</div>
      </li>`).join("")}</ol>`;
  } else {
    const u = g.ultimo;
    const resumen = (r: G.Resultado) => {
      const p = [
        r.creados && `${r.creados} creado${r.creados > 1 ? "s" : ""}`,
        r.actualizados && `${r.actualizados} actualizado${r.actualizados > 1 ? "s" : ""}`,
        r.borrados && `${r.borrados} borrado${r.borrados > 1 ? "s" : ""}`,
      ].filter(Boolean);
      return p.length ? p.join(", ") : "todo al día";
    };
    cuerpo = `
      <div class="g-ok"><span class="g-ok-dot"></span>Conectado</div>
      <div class="field">
        <span class="d-k">Calendario</span>
        <div class="g-line"><span class="g-strong">${esc(e.calendario!.nombre)}</span><button class="btn btn-ghost" data-act="g-cambiar">Cambiar</button></div>
      </div>
      <div class="field">
        <span class="d-k">Sincronización</span>
        <span class="g-txt">${g.sincronizando ? "Sincronizando…" : u ? `Última ${G.haceCuanto(u.fecha)} · ${resumen(u.r)}` : "Todavía no se sincronizó."}</span>
        <div><button class="btn btn-secondary" data-act="g-sync"${g.sincronizando ? " disabled" : ""}>Sincronizar ahora</button></div>
      </div>
      <div class="field">
        <span class="d-k">Avisos</span>
        <span class="g-txt">Cada vencimiento pendiente avisa el mismo día a las 9:00.</span>
      </div>
      <p class="hint">Notes solo crea, modifica y borra sus propios eventos. El resto del calendario no se toca.</p>`;
  }
  return `
    <div class="panel-h">
      <h2>Google Calendar</h2>
      <button class="icon-btn" data-act="close" aria-label="Cerrar">${ICON.x}</button>
    </div>
    <div class="panel-b g">
      ${g.error ? `<div class="g-error">${esc(g.error)}</div>` : ""}
      ${cuerpo}
    </div>
    ${e?.conectado ? `<div class="panel-f"><button class="btn btn-danger" data-act="g-desconectar">Desconectar</button></div>` : ""}`;
}

async function accionGoogle(act: string) {
  S.g.error = null;
  try {
    switch (act) {
      case "g-cred": {
        const [path] = await elegirArchivos();
        if (!path) return renderGoogle();
        await G.cargarCredenciales(path);
        break;
      }
      case "g-conectar":
        S.g.ocupado = "Esperando que autorices en el navegador…";
        renderGoogle();
        try {
          await G.conectar();
        } finally {
          S.g.ocupado = null;
        }
        await refrescarGoogle();
        return cargarCalendarios();
      case "g-cambiar":
        S.g.eligiendo = true;
        return cargarCalendarios();
      case "g-volver":
        S.g.eligiendo = false;
        return renderGoogle();
      case "g-sync":
        return syncGoogle(true);
      case "g-desconectar":
        await G.desconectar();
        S.g.ultimo = null;
        S.g.calendarios = null;
        break;
    }
  } catch (e) {
    S.g.error = String(e);
  }
  await refrescarGoogle();
}

async function elegirCalendarioGoogle(id: string) {
  const c = S.g.calendarios?.find((x) => x.id === id);
  if (!c) return;
  S.g.error = null;
  try {
    await G.elegirCalendario(c);
    S.g.eligiendo = false;
    await refrescarGoogle();
    await syncGoogle(true);
  } catch (e) {
    S.g.error = String(e);
    renderGoogle();
  }
}

$("#google").addEventListener("click", openGoogle);

// ---------- Barra superior ----------
$("#new").addEventListener("click", openNew);
$("#theme").addEventListener("click", () => {
  S.theme = S.theme === "oscuro" ? "claro" : "oscuro";
  S.themeStored = true;
  try { localStorage.setItem("agenda-theme", S.theme); } catch {}
  renderTheme();
  commit();
});

searchInput.addEventListener("input", () => {
  S.query = searchInput.value;
  renderSearch();
  renderList();
});
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.stopPropagation();
    S.query = "";
    renderSearch();
    renderList();
    searchInput.blur();
  }
});
$("#search-clear").addEventListener("click", (e) => {
  e.preventDefault();
  S.query = "";
  renderSearch();
  renderList();
  searchInput.focus();
});

if (isTauri) {
  import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
    const w = getCurrentWindow();
    $("#win-min").addEventListener("click", () => w.minimize());
    $("#win-close").addEventListener("click", () => w.close());
  });
  // Arrastrar archivos sobre la ventana con una nota abierta los adjunta a esa nota.
  import("@tauri-apps/api/webview").then(({ getCurrentWebview }) =>
    getCurrentWebview().onDragDropEvent(({ payload: p }) => {
      const panel = S.panel === "detail" ? panelRoot.querySelector(".panel") : null;
      if (p.type === "enter" || p.type === "over") return panel?.classList.add("drop");
      panelRoot.querySelector(".panel")?.classList.remove("drop");
      if (p.type !== "drop" || !p.paths.length) return;
      if (panel) attach(p.paths);
      else showToast("Abrí una nota para adjuntarle archivos");
    }));
} else {
  $(".winctl").style.display = "none";
}

// ---------- Atajos ----------
window.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === "n") {
    e.preventDefault();
    openNew();
  } else if (mod && k === "k") {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  } else if (mod && k === "enter" && S.panel === "form") {
    e.preventDefault();
    save();
  } else if (k === "escape") {
    if (S.confirm) {
      S.confirm = false;
      renderPanel();
    } else if (S.panel) cancelForm();
    else if (S.picked.size) clearPicked();
  }
});

// Si la app queda abierta y cambia el día, recalcula urgencias.
let lastDay = iso(today());
setInterval(() => {
  const d = iso(today());
  if (d === lastDay) return;
  lastDay = d;
  renderList();
  if (S.panel === "detail") renderPanel();
  else if (S.panel === "form") renderDates();
}, 60_000);

// ---------- Inicio ----------
async function init() {
  const pre = document.documentElement.dataset.theme;
  S.theme = pre === "oscuro" ? "oscuro" : "claro";
  renderTheme();
  try {
    const d = await load();
    S.notes = Array.isArray(d.notes) ? d.notes : [];
    if (d.theme === "claro" || d.theme === "oscuro") {
      S.theme = d.theme;
      S.themeStored = true;
      try { localStorage.setItem("agenda-theme", d.theme); } catch {}
      renderTheme();
    }
  } catch (e) {
    console.error("No se pudo cargar la agenda", e);
  }
  renderSearch();
  renderList();
  if (isTauri) {
    $("#google").hidden = false;
    await refrescarGoogle();
    syncGoogle();
  }
}

init();
