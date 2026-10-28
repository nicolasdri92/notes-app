mod comprobante;
mod google;

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_opener::OpenerExt;

const ARCHIVO: &str = "agenda.json";
const ADJUNTOS: &str = "adjuntos";

/// Copia de un archivo adjunto, guardada en `adjuntos/<id>/<name>`.
#[derive(Serialize, Deserialize, Clone)]
pub struct Adjunto {
    pub id: String,
    pub name: String,
    pub size: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Enlace {
    pub id: String,
    pub url: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Serie {
    pub id: String,
    /// Número de cuota (desde 1).
    pub n: u32,
    pub total: u32,
    /// "mensual" | "bimestral" | "cuotas"
    pub freq: String,
    /// Monto que dura 2 meses: paridad de la primera cuota de cada par.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub par: Option<u32>,
}

/// Datos para descargar el comprobante desde un sitio (ver `SITIOS` en `src/comprobantes.ts`).
#[derive(Serialize, Deserialize, Clone)]
pub struct Comprobante {
    pub sitio: String,
    #[serde(default)]
    pub datos: BTreeMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Nota {
    pub id: String,
    pub title: String,
    /// Fecha local sin hora, formato `YYYY-MM-DD`.
    pub date: String,
    pub amount: Option<f64>,
    #[serde(default)]
    pub desc: String,
    #[serde(default)]
    pub done: bool,
    #[serde(default)]
    pub series: Option<Serie>,
    /// Vencimiento único marcado como anual.
    #[serde(default)]
    pub anual: bool,
    #[serde(default)]
    pub files: Vec<Adjunto>,
    #[serde(default)]
    pub links: Vec<Enlace>,
    /// `Some(false)` = no se muestra en Google Calendar.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gcal: Option<bool>,
    /// `Some(true)` = evento privado en Google Calendar.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub privado: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comprobante: Option<Comprobante>,
}

#[derive(Serialize, Deserialize, Default)]
pub struct Datos {
    #[serde(default)]
    pub notes: Vec<Nota>,
    /// "claro" | "oscuro"; `None` = seguir al sistema.
    #[serde(default)]
    pub theme: Option<String>,
}

fn ruta(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(ARCHIVO))
}

pub(crate) fn dir_adjuntos(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join(ADJUNTOS);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Los ids los genera `adjuntar`; se validan para que nunca salgan de la carpeta de adjuntos.
fn id_valido(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Borra las copias que ya no usa ninguna nota (notas eliminadas o adjuntos quitados).
fn limpiar_adjuntos(base: &Path, datos: &Datos) {
    let usados: HashSet<&str> = datos
        .notes
        .iter()
        .flat_map(|n| n.files.iter().map(|a| a.id.as_str()))
        .collect();
    let Ok(entradas) = fs::read_dir(base) else { return };
    for e in entradas.flatten() {
        let nombre = e.file_name();
        if !usados.contains(nombre.to_string_lossy().as_ref()) {
            let _ = fs::remove_dir_all(e.path());
        }
    }
}

#[tauri::command]
fn load_data(app: AppHandle) -> Result<Datos, String> {
    let p = ruta(&app)?;
    if !p.exists() {
        return Ok(Datos::default());
    }
    let texto = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    match serde_json::from_str::<Datos>(&texto) {
        Ok(d) => {
            if let Ok(base) = dir_adjuntos(&app) {
                limpiar_adjuntos(&base, &d);
            }
            Ok(d)
        }
        Err(_) => {
            // Archivo dañado: se aparta en vez de pisarlo con la próxima escritura.
            let ts = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let _ = fs::rename(&p, p.with_file_name(format!("agenda.danado-{ts}.json")));
            Ok(Datos::default())
        }
    }
}

#[tauri::command]
fn save_data(app: AppHandle, data: Datos) -> Result<(), String> {
    let p = ruta(&app)?;
    let tmp = p.with_extension("json.tmp");
    let texto = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&tmp, texto).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

/// Copia los archivos elegidos a la carpeta de adjuntos de la app.
#[tauri::command]
fn adjuntar(app: AppHandle, paths: Vec<String>) -> Result<Vec<Adjunto>, String> {
    let base = dir_adjuntos(&app)?;
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    paths
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let origen = PathBuf::from(p);
            if !origen.is_file() {
                return Err(format!("No es un archivo: {p}"));
            }
            let name = origen
                .file_name()
                .ok_or_else(|| format!("Ruta inválida: {p}"))?
                .to_string_lossy()
                .into_owned();
            let id = format!("{ts:x}-{i}");
            let dir = base.join(&id);
            fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let size = fs::copy(&origen, dir.join(&name)).map_err(|e| e.to_string())?;
            Ok(Adjunto { id, name, size })
        })
        .collect()
}

/// Abre el adjunto con la aplicación predeterminada del sistema.
#[tauri::command]
fn abrir_adjunto(app: AppHandle, id: String) -> Result<(), String> {
    if !id_valido(&id) {
        return Err("Adjunto inválido".into());
    }
    let dir = dir_adjuntos(&app)?.join(&id);
    let archivo = fs::read_dir(&dir)
        .map_err(|_| "El archivo ya no existe".to_string())?
        .flatten()
        .map(|e| e.path())
        .find(|p| p.is_file())
        .ok_or_else(|| "El archivo ya no existe".to_string())?;
    app.opener()
        .open_path(archivo.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Abre un link en el navegador predeterminado. Solo web y correo.
#[tauri::command]
fn abrir_link(app: AppHandle, url: String) -> Result<(), String> {
    let ok = ["http://", "https://", "mailto:"]
        .iter()
        .any(|p| url.to_ascii_lowercase().starts_with(p));
    if !ok {
        return Err("Link no permitido".into());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

fn mostrar_ventana(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Ícono en la barra superior: la app sigue corriendo aunque se cierre la ventana.
fn crear_bandeja(app: &tauri::App) -> tauri::Result<()> {
    let abrir = MenuItem::with_id(app, "abrir", "Abrir Notes", true, None::<&str>)?;
    let salir = MenuItem::with_id(app, "salir", "Salir", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&abrir, &PredefinedMenuItem::separator(app)?, &salir])?;
    let mut bandeja = TrayIconBuilder::with_id("notes")
        .tooltip("Notes")
        .menu(&menu)
        .on_menu_event(|app, e| match e.id().as_ref() {
            "abrir" => mostrar_ventana(app),
            "salir" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                mostrar_ventana(tray.app_handle());
            }
        });
    if let Some(icono) = app.default_window_icon() {
        bandeja = bandeja.icon(icono.clone());
    }
    bandeja.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Una sola instancia: abrirla de nuevo (dock, inicio automático) trae al frente la que ya está.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| mostrar_ventana(app)))
        .plugin(tauri_plugin_dialog::init())
        .manage(google::Sesion::default())
        .manage(comprobante::Descarga::default())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            crear_bandeja(app)?;
            // Con --hidden (inicio automático) arranca solo en la barra superior.
            if !std::env::args().any(|a| a == "--hidden") {
                mostrar_ventana(app.handle());
            }
            Ok(())
        })
        // Cerrar la ventana principal la esconde; para salir del todo está «Salir» en la barra superior.
        .on_window_event(|w, e| {
            if let (WindowEvent::CloseRequested { api, .. }, "main") = (e, w.label()) {
                api.prevent_close();
                let _ = w.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            adjuntar,
            abrir_adjunto,
            abrir_link,
            google::google_estado,
            google::google_cargar_credenciales,
            google::google_conectar,
            google::google_calendarios,
            google::google_elegir_calendario,
            google::google_desconectar,
            google::google_sync,
            comprobante::comprobante_abrir,
            comprobante::comprobante_recibido,
            comprobante::comprobante_cerrar_popups
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar la aplicación");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn nota(files: Vec<&str>) -> Nota {
        Nota {
            id: "n".into(),
            title: "t".into(),
            date: "2026-10-13".into(),
            amount: None,
            desc: String::new(),
            done: false,
            series: None,
            anual: false,
            links: vec![],
            gcal: None,
            privado: None,
            comprobante: None,
            files: files
                .into_iter()
                .map(|id| Adjunto { id: id.into(), name: "f.pdf".into(), size: 1 })
                .collect(),
        }
    }

    #[test]
    fn limpiar_borra_solo_lo_no_usado() {
        let base = std::env::temp_dir().join(format!("agenda-test-{}", std::process::id()));
        for id in ["usado", "huerfano"] {
            fs::create_dir_all(base.join(id)).unwrap();
            fs::write(base.join(id).join("f.pdf"), b"x").unwrap();
        }
        let datos = Datos { notes: vec![nota(vec!["usado"])], theme: None };
        limpiar_adjuntos(&base, &datos);
        assert!(base.join("usado/f.pdf").exists());
        assert!(!base.join("huerfano").exists());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn ids_validos() {
        assert!(id_valido("18f3a9c2b-0"));
        assert!(!id_valido(""));
        assert!(!id_valido("../agenda.json"));
        assert!(!id_valido("a/b"));
    }

    #[test]
    fn notas_viejas_sin_adjuntos_se_leen() {
        let d: Datos = serde_json::from_str(
            r#"{"notes":[{"id":"x","title":"GASNEA","date":"2026-10-13","amount":null,"desc":"","done":false,"series":null}],"theme":"claro"}"#,
        )
        .unwrap();
        assert!(d.notes[0].files.is_empty());
    }
}
