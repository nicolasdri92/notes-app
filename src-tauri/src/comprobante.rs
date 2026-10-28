//! Descarga de comprobantes desde sitios con captcha: se abre el sitio en una ventana de la app,
//! se completa el formulario y, cuando el usuario resuelve el captcha, el PDF que devuelve el
//! sitio se guarda como adjunto de la nota.

use crate::{dir_adjuntos, Adjunto};
use base64::Engine;
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State, Webview, WebviewUrl, WebviewWindowBuilder};

const VENTANA: &str = "comprobante";
const POPUP: &str = "comprobante-popup-";
const MAX_BYTES: usize = 20 * 1024 * 1024;

/// Se inyecta en el sitio: completa el formulario y captura la respuesta con el PDF.
const SCRIPT: &str = include_str!("comprobante.js");

/// Descarga en curso: a qué nota va el PDF y desde qué sitio puede llegar.
struct Pendiente {
    nota_id: String,
    nombre: String,
    host: String,
}

#[derive(Default)]
pub struct Descarga(Mutex<Option<Pendiente>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Listo {
    nota_id: String,
    adjunto: Adjunto,
    /// Texto del PDF, para leer el monto y el vencimiento. `None` si no se pudo extraer.
    texto: Option<String>,
}

/// Texto del PDF guardado en `ruta`. `pdf-extract` no puede con algunos PDFs (p. ej. los de
/// COOPELEC entra en pánico): entonces se prueba con `pdftotext` (poppler-utils), si está instalado.
fn texto_pdf(bytes: &[u8], ruta: &Path) -> Option<String> {
    std::panic::catch_unwind(|| pdf_extract::extract_text_from_mem(bytes).ok())
        .ok()
        .flatten()
        .or_else(|| {
            let salida = std::process::Command::new("pdftotext").arg(ruta).arg("-").output().ok()?;
            salida.status.success().then(|| String::from_utf8_lossy(&salida.stdout).into_owned())
        })
}

/// Nombre de archivo seguro: sin separadores de ruta ni caracteres de control.
fn nombre_seguro(nombre: &str) -> String {
    let limpio: String = nombre
        .chars()
        .map(|c| if c == '/' || c == '\\' || c.is_control() { '-' } else { c })
        .collect();
    let limpio = limpio.trim().trim_start_matches('.').to_string();
    let base = if limpio.is_empty() { "comprobante".to_string() } else { limpio };
    if base.to_ascii_lowercase().ends_with(".pdf") { base } else { format!("{base}.pdf") }
}

/// Abre el sitio en una ventana propia con el formulario completo según `pasos`.
#[tauri::command]
pub fn comprobante_abrir(
    app: AppHandle,
    descarga: State<'_, Descarga>,
    nota_id: String,
    url: String,
    pasos: serde_json::Value,
    captura: String,
    instruccion: String,
    nombre: String,
    puertos_tls: Vec<u16>,
) -> Result<(), String> {
    let destino = url::Url::parse(&url).map_err(|_| "URL inválida".to_string())?;
    if destino.scheme() != "https" {
        return Err("Solo se permiten sitios https".into());
    }
    let host = destino.host_str().ok_or("URL inválida")?.to_string();
    // Una sola descarga a la vez: la ventana anterior se reemplaza.
    if let Some(w) = app.get_webview_window(VENTANA) {
        let _ = w.destroy();
    }
    *descarga.0.lock().unwrap() = Some(Pendiente { nota_id, nombre: nombre_seguro(&nombre), host: host.clone() });

    let config = serde_json::json!({ "host": host, "pasos": pasos, "captura": captura, "instruccion": instruccion });
    let script = format!("window.__NOTES_COMPROBANTE__ = {config};\n{SCRIPT}");
    let ventana = WebviewWindowBuilder::new(&app, VENTANA, WebviewUrl::External(destino))
        .title("Descargar comprobante · Notes")
        .inner_size(1000.0, 760.0)
        .center()
        .initialization_script(script)
        .on_new_window({
            let app = app.clone();
            move |_url, features| popup(&app, features)
        })
        .build()
        .map_err(|e| e.to_string())?;
    reparar_tls(&ventana, &host, puertos_tls);
    ventana.on_window_event({
        let app = app.clone();
        move |e| {
            if let tauri::WindowEvent::Destroyed = e {
                *app.state::<Descarga>().0.lock().unwrap() = None;
                // Los popups que hayan quedado abiertos (p. ej. el login) se van con la ventana.
                cerrar_popups(&app);
            }
        }
    });
    Ok(())
}

/// Ventanas que abre el sitio (p. ej. el login con Google): se abren relacionadas con la del
/// comprobante para que puedan devolverle el resultado. No tienen acceso a ningún comando.
fn popup(app: &AppHandle, features: tauri::webview::NewWindowFeatures) -> tauri::webview::NewWindowResponse<tauri::Wry> {
    static N: AtomicU32 = AtomicU32::new(0);
    let label = format!("{POPUP}{}", N.fetch_add(1, Ordering::Relaxed));
    let url = WebviewUrl::External("about:blank".parse().unwrap());
    let Ok(window) = WebviewWindowBuilder::new(app, label, url)
        .window_features(features)
        .title("Notes")
        .build()
    else {
        return tauri::webview::NewWindowResponse::Deny;
    };
    cerrar_con_window_close(&window);
    tauri::webview::NewWindowResponse::Create { window }
}

/// En Linux, `window.close()` (el login de Google lo llama al terminar) solo destruye el
/// contenido y deja la ventana vacía: se cierra la ventana entera.
#[cfg(target_os = "linux")]
fn cerrar_con_window_close(window: &tauri::WebviewWindow) {
    let w = window.clone();
    let _ = window.with_webview(move |pv| {
        use webkit2gtk::WebViewExt;
        pv.inner().connect_close(move |_| {
            let _ = w.destroy();
        });
    });
}

#[cfg(not(target_os = "linux"))]
fn cerrar_con_window_close(_window: &tauri::WebviewWindow) {}

fn cerrar_popups(app: &AppHandle) {
    for (label, w) in app.webview_windows() {
        if label.starts_with(POPUP) {
            let _ = w.destroy();
        }
    }
}

/// Algunos sitios sirven su API en otros puertos sin los certificados intermedios: los navegadores
/// los completan solos, WebKitGTK no y rechaza la conexión. Si el certificado de ese puerto es
/// idéntico al del puerto 443 (que sí se valida normalmente), se lo acepta para ese host.
#[cfg(target_os = "linux")]
fn reparar_tls(ventana: &tauri::WebviewWindow, host: &str, puertos: Vec<u16>) {
    if puertos.is_empty() {
        return;
    }
    let (ventana, host) = (ventana.clone(), host.to_string());
    std::thread::spawn(move || {
        for puerto in puertos {
            let Some(pem) = certificado_igual_al_443(&host, puerto) else { continue };
            let host = host.clone();
            let _ = ventana.with_webview(move |pv| {
                use webkit2gtk::{gio, WebContextExt, WebViewExt};
                if let (Ok(cert), Some(ctx)) = (gio::TlsCertificate::from_pem(&pem), pv.inner().context()) {
                    ctx.allow_tls_certificate_for_host(&cert, &host);
                }
            });
        }
    });
}

#[cfg(not(target_os = "linux"))]
fn reparar_tls(_ventana: &tauri::WebviewWindow, _host: &str, _puertos: Vec<u16>) {}

/// PEM del certificado que presenta `host:puerto`, solo si es el mismo que el de `host:443`
/// (validado contra los certificados del sistema).
#[cfg(target_os = "linux")]
fn certificado_igual_al_443(host: &str, puerto: u16) -> Option<String> {
    use webkit2gtk::gio::{self, prelude::*};
    let pedir = |puerto: u16, sin_validar: bool| -> Option<gio::TlsCertificate> {
        let cliente = gio::SocketClient::new();
        cliente.set_tls(true);
        cliente.set_timeout(10);
        let leido = std::rc::Rc::new(std::cell::RefCell::new(None));
        let guardar = leido.clone();
        cliente.connect_event(move |_, evento, _, conexion| {
            let Some(tls) = conexion.and_then(|c| c.downcast_ref::<gio::TlsConnection>()) else { return };
            match evento {
                // Solo para leer el certificado: se acepta acá y se compara después.
                gio::SocketClientEvent::TlsHandshaking if sin_validar => {
                    tls.connect_accept_certificate(|_, _, _| true);
                }
                gio::SocketClientEvent::TlsHandshaked => *guardar.borrow_mut() = tls.peer_certificate(),
                _ => {}
            }
        });
        cliente.connect_to_host(&format!("{host}:{puerto}"), puerto, gio::Cancellable::NONE).ok()?;
        let cert = leido.borrow_mut().take();
        cert
    };
    let valido = pedir(443, false)?;
    let otro = pedir(puerto, true)?;
    valido.is_same(&otro).then(|| otro.certificate_pem()).flatten().map(|p| p.to_string())
}

/// Lo llama el script inyectado cuando el login del sitio terminó.
#[tauri::command]
pub fn comprobante_cerrar_popups(app: AppHandle, webview: Webview) {
    if webview.label() == VENTANA {
        cerrar_popups(&app);
    }
}

/// Lo llama el script inyectado con el PDF en base64. Solo se acepta desde la ventana del
/// comprobante, con una descarga pendiente y desde el sitio que se abrió.
#[tauri::command]
pub fn comprobante_recibido(
    app: AppHandle,
    webview: Webview,
    descarga: State<'_, Descarga>,
    datos: String,
) -> Result<(), String> {
    if webview.label() != VENTANA {
        return Err("No permitido".into());
    }
    let host = webview.url().ok().and_then(|u| u.host_str().map(str::to_string));
    let pendiente = {
        let mut p = descarga.0.lock().unwrap();
        match p.as_ref() {
            Some(x) if host.as_deref() == Some(x.host.as_str()) => p.take().unwrap(),
            _ => return Err("No hay ninguna descarga pendiente".into()),
        }
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(datos)
        .map_err(|_| "Datos inválidos".to_string())?;
    if bytes.len() > MAX_BYTES || !bytes.starts_with(b"%PDF") {
        return Err("La respuesta no es un PDF".into());
    }
    let ts = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let id = format!("{ts:x}-c");
    let dir = dir_adjuntos(&app)?.join(&id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ruta = dir.join(&pendiente.nombre);
    fs::write(&ruta, &bytes).map_err(|e| e.to_string())?;
    let texto = texto_pdf(&bytes, &ruta);
    let adjunto = Adjunto { id, name: pendiente.nombre, size: bytes.len() as u64 };
    app.emit_to("main", "comprobante", Listo { nota_id: pendiente.nota_id, adjunto, texto })
        .map_err(|e| e.to_string())?;
    if let Some(w) = app.get_webview_window(VENTANA) {
        let _ = w.close();
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_focus();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::nombre_seguro;

    #[test]
    fn nombres_seguros() {
        assert_eq!(nombre_seguro("OS - Augusto Niez 2026-10"), "OS - Augusto Niez 2026-10.pdf");
        assert_eq!(nombre_seguro("../../agenda.json"), "-..-agenda.json.pdf");
        assert_eq!(nombre_seguro("a/b.PDF"), "a-b.PDF");
        assert_eq!(nombre_seguro("  "), "comprobante.pdf");
    }
}
