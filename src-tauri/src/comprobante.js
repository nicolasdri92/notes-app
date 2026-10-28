// Se inyecta en la ventana del comprobante. `window.__NOTES_COMPROBANTE__` trae:
//   host: sitio donde actuar; captura: fragmento de la URL de la respuesta con el PDF (binario,
//     o JSON con el PDF en base64 en algún campo); vacío = cualquier respuesta con un PDF;
//   instruccion: qué tiene que hacer el usuario una vez completo el formulario;
//   pasos: [{ elegir: "<selector del combo>", texto }] | [{ escribir: "<id del campo>", valor }]
(() => {
  const cfg = window.__NOTES_COMPROBANTE__;
  if (!cfg || window.top !== window || location.hostname !== cfg.host) return;

  // ---------- Captura del PDF ----------
  let enviado = false;
  const aBase64 = (buf) => {
    const b = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const esPdf = (buf) => {
    const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
    return String.fromCharCode(...b) === "%PDF";
  };
  // Busca un PDF en base64 ("JVBER" = "%PDF") dentro de una respuesta JSON.
  const pdfEnJson = (texto) => {
    let v;
    try { v = JSON.parse(texto); } catch { return null; }
    const pila = [v];
    while (pila.length) {
      const x = pila.pop();
      if (typeof x === "string") {
        const b64 = x.includes(",") && x.startsWith("data:") ? x.split(",")[1] : x;
        if (b64.startsWith("JVBER")) return b64;
      } else if (x && typeof x === "object") pila.push(...Object.values(x));
    }
    return null;
  };
  const recibir = (url, resp) => {
    if (enviado || (cfg.captura && !String(url).includes(cfg.captura))) return;
    const datos = resp instanceof ArrayBuffer ? (esPdf(resp) ? aBase64(resp) : null)
      : typeof resp === "string" ? pdfEnJson(resp) : null;
    if (!datos) return;
    enviado = true;
    aviso("Comprobante descargado. Adjuntándolo a la nota…");
    window.__TAURI_INTERNALS__.invoke("comprobante_recibido", { datos }).catch((e) => {
      enviado = false;
      aviso("No se pudo adjuntar el comprobante: " + e);
    });
  };

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.addEventListener("load", () => {
      if (this.status !== 200) return;
      if (this.response instanceof ArrayBuffer) recibir(url, this.response);
      else if (this.responseType === "" || this.responseType === "text") recibir(url, this.responseText);
      else if (this.responseType === "json") recibir(url, JSON.stringify(this.response));
    });
    return open.apply(this, arguments);
  };
  const fetchOrig = window.fetch;
  window.fetch = async function (input, init) {
    const r = await fetchOrig.apply(this, arguments);
    const url = typeof input === "string" ? input : input?.url;
    if (r.ok && (!cfg.captura || String(url).includes(cfg.captura))) {
      const c = r.clone();
      (/json/.test(r.headers.get("content-type") || "") ? c.text() : c.arrayBuffer()).then((b) => recibir(url, b), () => {});
    }
    return r;
  };

  // ---------- Popups de login ----------
  // Cuando el login (Google, etc.) le devuelve el resultado al sitio, su popup ya no hace falta.
  // Solo cuentan los mensajes de un popup abierto por el sitio: también llegan mensajes de iframes
  // (el botón de Google, el chatbot, analytics…).
  const popups = new Set();
  const openOrig = window.open;
  window.open = function () {
    const w = openOrig.apply(this, arguments);
    if (w) popups.add(w);
    return w;
  };
  window.addEventListener("message", (e) => {
    if (!popups.has(e.source)) return;
    setTimeout(() => window.__TAURI_INTERNALS__.invoke("comprobante_cerrar_popups").catch(() => {}), 1500);
  });

  // ---------- Aviso arriba de la página ----------
  let cartel;
  function aviso(texto) {
    if (!document.body) return void document.addEventListener("DOMContentLoaded", () => aviso(texto), { once: true });
    if (!cartel) {
      cartel = document.createElement("div");
      cartel.style.cssText =
        "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:10px 16px;" +
        "border-radius:8px;background:#1f2328;color:#fff;font:500 14px/1.4 system-ui,sans-serif;" +
        "box-shadow:0 6px 24px rgba(0,0,0,.25);max-width:90vw;text-align:center;pointer-events:none";
      document.body.appendChild(cartel);
    }
    cartel.textContent = texto;
  }

  // ---------- Completar el formulario ----------
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
  async function esperar(fn, ms = 20000) {
    const t = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t > ms) throw new Error("timeout");
      await dormir(150);
    }
  }
  // Combo de PrimeNG: abrir el desplegable y tocar la opción con ese texto.
  async function elegir(selector, texto) {
    const combo = await esperar(() => document.querySelector(selector)?.closest(".p-dropdown"));
    combo.click();
    const op = await esperar(() =>
      [...document.querySelectorAll("li[role=option]")].find((li) => li.textContent.trim() === texto));
    op.click();
    await dormir(150);
  }
  async function escribir(id, valor) {
    const el = await esperar(() => document.getElementById(id));
    el.value = valor;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }

  async function completar() {
    try {
      for (const p of cfg.pasos) {
        if (p.elegir) await elegir(p.elegir, p.texto);
        else if (p.escribir) await escribir(p.escribir, p.valor);
      }
      aviso(cfg.instruccion);
    } catch {
      aviso("No se pudo completar el formulario solo. Completalo a mano: el PDF se adjunta igual.");
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", completar, { once: true });
  else completar();
})();
