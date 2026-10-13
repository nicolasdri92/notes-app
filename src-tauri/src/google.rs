//! Sincronización Notes → Google Calendar.
//!
//! Conexión OAuth 2.0 para apps de escritorio (redirección a 127.0.0.1 + PKCE). El token de
//! actualización queda en `google.json`, dentro de la carpeta de datos de la app, con permisos 600.
//! Notes solo toca los eventos que creó: los marca con `extendedProperties.private.notesApp = "1"`.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use url::Url;

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
const API: &str = "https://www.googleapis.com/calendar/v3";
const SCOPES: &str = "https://www.googleapis.com/auth/calendar.events \
                      https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const ARCHIVO: &str = "google.json";

/// Aviso de los eventos de día completo: el mismo día a las 9:00 (minutos después del inicio).
const AVISO_MISMO_DIA: i64 = -540;
/// Si Google no acepta el aviso anterior, a las 0:00 del mismo día.
const AVISO_RESPALDO: i64 = 0;

#[derive(Serialize, Deserialize, Default, Clone)]
struct Config {
    client_id: String,
    client_secret: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    calendar_id: Option<String>,
    #[serde(default)]
    calendar_name: Option<String>,
    /// Minutos del aviso que Google aceptó (se descubre en la primera sincronización).
    #[serde(default)]
    aviso: Option<i64>,
}

/// Token de acceso en memoria (dura ~1 hora).
#[derive(Default)]
pub struct Sesion(Mutex<Option<(String, Instant)>>);

#[derive(Serialize, Clone)]
pub struct Calendario {
    id: String,
    nombre: String,
    principal: bool,
}

#[derive(Serialize)]
pub struct Estado {
    credenciales: bool,
    conectado: bool,
    calendario: Option<Calendario>,
}

/// Evento deseado para una nota (lo arma el frontend).
#[derive(Deserialize)]
pub struct EventoNota {
    id: String,
    summary: String,
    description: String,
    /// Inicio y fin (exclusivo) del evento de día completo, `YYYY-MM-DD`.
    date: String,
    end: String,
    reminder: bool,
}

#[derive(Serialize, Default)]
pub struct Resultado {
    creados: u32,
    actualizados: u32,
    borrados: u32,
}

// ---------- Configuración ----------

fn ruta(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(ARCHIVO))
}

fn leer(app: &AppHandle) -> Result<Option<Config>, String> {
    let p = ruta(app)?;
    if !p.exists() {
        return Ok(None);
    }
    let texto = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    serde_json::from_str(&texto).map(Some).map_err(|e| e.to_string())
}

fn guardar(app: &AppHandle, cfg: &Config) -> Result<(), String> {
    let p = ruta(app)?;
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
    }
    fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

fn requerir(app: &AppHandle) -> Result<Config, String> {
    leer(app)?.ok_or_else(|| "Primero cargá las credenciales de Google.".into())
}

// ---------- OAuth ----------

fn aleatorio(bytes: usize) -> Result<String, String> {
    let mut buf = vec![0u8; bytes];
    getrandom::getrandom(&mut buf).map_err(|e| e.to_string())?;
    Ok(URL_SAFE_NO_PAD.encode(buf))
}

async fn error_de(resp: reqwest::Response) -> String {
    let status = resp.status();
    let cuerpo: Value = resp.json().await.unwrap_or(Value::Null);
    let msg = cuerpo["error"]["message"]
        .as_str()
        .or(cuerpo["error_description"].as_str())
        .or(cuerpo["error"].as_str())
        .unwrap_or("error desconocido");
    format!("Google respondió {status}: {msg}")
}

/// Token de acceso válido, renovándolo con el de actualización si hace falta.
async fn token(app: &AppHandle, sesion: &Sesion) -> Result<String, String> {
    if let Some((t, vence)) = sesion.0.lock().unwrap().as_ref() {
        if *vence > Instant::now() + Duration::from_secs(60) {
            return Ok(t.clone());
        }
    }
    let mut cfg = requerir(app)?;
    let refresh = cfg
        .refresh_token
        .clone()
        .ok_or("Notes no está conectada a Google.")?;
    let resp = reqwest::Client::new()
        .post(TOKEN_URL)
        .form(&[
            ("client_id", cfg.client_id.as_str()),
            ("client_secret", cfg.client_secret.as_str()),
            ("refresh_token", refresh.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|e| format!("Sin conexión con Google: {e}"))?;
    if !resp.status().is_success() {
        let err = error_de(resp).await;
        if err.contains("invalid_grant") || err.contains("expired") || err.contains("revoked") {
            cfg.refresh_token = None;
            guardar(app, &cfg)?;
            return Err("La conexión con Google venció o fue revocada. Volvé a conectar.".into());
        }
        return Err(err);
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    let t = v["access_token"].as_str().ok_or("Google no devolvió un token")?.to_string();
    let dura = v["expires_in"].as_u64().unwrap_or(3600);
    *sesion.0.lock().unwrap() = Some((t.clone(), Instant::now() + Duration::from_secs(dura)));
    Ok(t)
}

/// Espera la redirección de Google en 127.0.0.1 y devuelve el código de autorización.
async fn esperar_codigo(listener: &TcpListener, state: &str) -> Result<String, String> {
    loop {
        let (mut s, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 8192];
        let n = s.read(&mut buf).await.map_err(|e| e.to_string())?;
        let pedido = String::from_utf8_lossy(&buf[..n]);
        let path = pedido.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("/");
        let url = Url::parse(&format!("http://127.0.0.1{path}")).map_err(|e| e.to_string())?;
        let q: HashMap<String, String> = url.query_pairs().into_owned().collect();
        if !q.contains_key("code") && !q.contains_key("error") {
            // Otros pedidos del navegador (p. ej. favicon).
            let _ = s.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n").await;
            continue;
        }
        let (resultado, titulo, texto) = if q.get("state").map(String::as_str) != Some(state) {
            (Err("La respuesta de Google no coincide con el pedido.".to_string()), "Algo salió mal", "Volvé a Notes e intentá de nuevo.")
        } else if q.contains_key("error") {
            (Err("Cancelaste la autorización en Google.".to_string()), "Autorización cancelada", "Podés cerrar esta pestaña y volver a Notes.")
        } else {
            (Ok(q["code"].clone()), "Notes quedó conectada", "Ya podés cerrar esta pestaña y volver a Notes.")
        };
        let html = format!(
            "<!doctype html><meta charset=utf-8><title>Notes</title>\
             <body style=\"font-family:system-ui;background:#F7F6F3;color:#1F1D1A;display:grid;place-items:center;height:100vh;margin:0\">\
             <div style=\"text-align:center\"><h2 style=\"margin:0 0 8px\">{titulo}</h2><p style=\"color:#67635B;margin:0\">{texto}</p></div>"
        );
        let resp = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}",
            html.len()
        );
        let _ = s.write_all(resp.as_bytes()).await;
        return resultado;
    }
}

// ---------- Llamadas a la API ----------

async fn api(
    token: &str,
    metodo: reqwest::Method,
    url: &str,
    query: &[(&str, String)],
    cuerpo: Option<&Value>,
) -> Result<Value, String> {
    let mut req = reqwest::Client::new()
        .request(metodo, url)
        .bearer_auth(token)
        .query(query);
    if let Some(c) = cuerpo {
        req = req.json(c);
    }
    let resp = req.send().await.map_err(|e| format!("Sin conexión con Google: {e}"))?;
    if resp.status() == reqwest::StatusCode::NO_CONTENT || resp.status() == reqwest::StatusCode::GONE {
        return Ok(Value::Null);
    }
    if !resp.status().is_success() {
        return Err(error_de(resp).await);
    }
    resp.json().await.map_err(|e| e.to_string())
}

fn enc(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

fn cuerpo_evento(e: &EventoNota, aviso: i64) -> Value {
    let overrides = if e.reminder {
        json!([{ "method": "popup", "minutes": aviso }])
    } else {
        json!([])
    };
    json!({
        "summary": e.summary,
        "description": e.description,
        "start": { "date": e.date },
        "end": { "date": e.end },
        "transparency": "transparent",
        "reminders": { "useDefault": false, "overrides": overrides },
        "extendedProperties": { "private": { "notesApp": "1", "notesId": e.id } },
    })
}

/// ¿El evento de Google difiere del que debería tener la nota?
fn difiere(actual: &Value, deseado: &Value) -> bool {
    let s = |v: &Value, k: &str| v[k].as_str().unwrap_or("").trim_end().to_string();
    let avisos = |v: &Value| -> Vec<i64> {
        v["reminders"]["overrides"]
            .as_array()
            .map(|a| a.iter().filter_map(|r| r["minutes"].as_i64()).collect())
            .unwrap_or_default()
    };
    s(actual, "summary") != s(deseado, "summary")
        || s(actual, "description") != s(deseado, "description")
        || actual["start"]["date"] != deseado["start"]["date"]
        || actual["end"]["date"] != deseado["end"]["date"]
        || actual["reminders"]["useDefault"].as_bool().unwrap_or(true)
        || avisos(actual) != avisos(deseado)
}

// ---------- Comandos ----------

#[tauri::command]
pub fn google_estado(app: AppHandle) -> Result<Estado, String> {
    let cfg = leer(&app)?;
    Ok(Estado {
        credenciales: cfg.is_some(),
        conectado: cfg.as_ref().map_or(false, |c| c.refresh_token.is_some()),
        calendario: cfg.and_then(|c| {
            Some(Calendario { id: c.calendar_id?, nombre: c.calendar_name.unwrap_or_default(), principal: false })
        }),
    })
}

/// Lee el JSON descargado de Google Cloud (cliente OAuth de tipo «App de escritorio»).
#[tauri::command]
pub fn google_cargar_credenciales(app: AppHandle, sesion: State<'_, Sesion>, path: String) -> Result<(), String> {
    let texto = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&texto)
        .map_err(|_| "El archivo no es un JSON de credenciales de Google.".to_string())?;
    let c = v.get("installed").ok_or_else(|| {
        if v.get("web").is_some() {
            "Esas credenciales son de tipo «Aplicación web». Creá un cliente de tipo «App de escritorio».".to_string()
        } else {
            "El archivo no es un JSON de credenciales OAuth de Google.".to_string()
        }
    })?;
    let id = c["client_id"].as_str().ok_or("Falta client_id en el archivo.")?;
    let secret = c["client_secret"].as_str().ok_or("Falta client_secret en el archivo.")?;
    let anterior = leer(&app)?.unwrap_or_default();
    // Mismas credenciales: se conserva la conexión y el calendario.
    let cfg = if anterior.client_id == id {
        Config { client_secret: secret.into(), ..anterior }
    } else {
        *sesion.0.lock().unwrap() = None;
        Config { client_id: id.into(), client_secret: secret.into(), ..Default::default() }
    };
    guardar(&app, &cfg)
}

#[tauri::command]
pub async fn google_conectar(app: AppHandle, sesion: State<'_, Sesion>) -> Result<(), String> {
    let mut cfg = requerir(&app)?;
    let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
    let redirect = format!("http://127.0.0.1:{}", listener.local_addr().map_err(|e| e.to_string())?.port());
    let verifier = aleatorio(48)?;
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let state = aleatorio(18)?;
    let url = Url::parse_with_params(
        AUTH_URL,
        &[
            ("client_id", cfg.client_id.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("response_type", "code"),
            ("scope", SCOPES),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("state", state.as_str()),
            ("access_type", "offline"),
            ("prompt", "consent"),
        ],
    )
    .map_err(|e| e.to_string())?;
    app.opener().open_url(url.as_str(), None::<&str>).map_err(|e| e.to_string())?;

    let code = tokio::time::timeout(Duration::from_secs(300), esperar_codigo(&listener, &state))
        .await
        .map_err(|_| "Pasaron 5 minutos sin respuesta de Google. Intentá de nuevo.".to_string())??;

    let resp = reqwest::Client::new()
        .post(TOKEN_URL)
        .form(&[
            ("client_id", cfg.client_id.as_str()),
            ("client_secret", cfg.client_secret.as_str()),
            ("code", code.as_str()),
            ("code_verifier", verifier.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|e| format!("Sin conexión con Google: {e}"))?;
    if !resp.status().is_success() {
        return Err(error_de(resp).await);
    }
    let v: Value = resp.json().await.map_err(|e| e.to_string())?;
    let refresh = v["refresh_token"].as_str().ok_or("Google no devolvió un token de actualización.")?;
    if let Some(t) = v["access_token"].as_str() {
        let dura = v["expires_in"].as_u64().unwrap_or(3600);
        *sesion.0.lock().unwrap() = Some((t.to_string(), Instant::now() + Duration::from_secs(dura)));
    }
    cfg.refresh_token = Some(refresh.to_string());
    guardar(&app, &cfg)
}

/// Calendarios donde la cuenta puede crear eventos.
#[tauri::command]
pub async fn google_calendarios(app: AppHandle, sesion: State<'_, Sesion>) -> Result<Vec<Calendario>, String> {
    let t = token(&app, &sesion).await?;
    let v = api(
        &t,
        reqwest::Method::GET,
        &format!("{API}/users/me/calendarList"),
        &[("minAccessRole", "writer".into()), ("maxResults", "250".into())],
        None,
    )
    .await?;
    let mut lista: Vec<Calendario> = v["items"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|c| {
                    Some(Calendario {
                        id: c["id"].as_str()?.into(),
                        nombre: c["summaryOverride"].as_str().or(c["summary"].as_str())?.into(),
                        principal: c["primary"].as_bool().unwrap_or(false),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    lista.sort_by(|a, b| b.principal.cmp(&a.principal).then(a.nombre.to_lowercase().cmp(&b.nombre.to_lowercase())));
    Ok(lista)
}

#[tauri::command]
pub fn google_elegir_calendario(app: AppHandle, id: String, nombre: String) -> Result<(), String> {
    let mut cfg = requerir(&app)?;
    cfg.calendar_id = Some(id);
    cfg.calendar_name = Some(nombre);
    guardar(&app, &cfg)
}

/// Revoca el acceso en Google y olvida el token. Los eventos ya creados quedan en el calendario.
#[tauri::command]
pub async fn google_desconectar(app: AppHandle, sesion: State<'_, Sesion>) -> Result<(), String> {
    let mut cfg = requerir(&app)?;
    if let Some(r) = cfg.refresh_token.take() {
        let _ = reqwest::Client::new().post(REVOKE_URL).form(&[("token", r)]).send().await;
    }
    cfg.calendar_id = None;
    cfg.calendar_name = None;
    *sesion.0.lock().unwrap() = None;
    guardar(&app, &cfg)
}

/// Deja los eventos de Notes en el calendario elegido iguales a las notas recibidas.
#[tauri::command]
pub async fn google_sync(
    app: AppHandle,
    sesion: State<'_, Sesion>,
    eventos: Vec<EventoNota>,
) -> Result<Resultado, String> {
    let mut cfg = requerir(&app)?;
    let cal = cfg.calendar_id.clone().ok_or("Elegí un calendario de Google.")?;
    let t = token(&app, &sesion).await?;
    let base = format!("{API}/calendars/{}/events", enc(&cal));

    // Eventos que Notes ya creó en ese calendario, por id de nota.
    let mut existentes: HashMap<String, Value> = HashMap::new();
    let mut sobrantes: Vec<String> = Vec::new();
    let mut pagina: Option<String> = None;
    loop {
        let mut q = vec![
            ("privateExtendedProperty", "notesApp=1".to_string()),
            ("maxResults", "2500".to_string()),
        ];
        if let Some(p) = &pagina {
            q.push(("pageToken", p.clone()));
        }
        let v = api(&t, reqwest::Method::GET, &base, &q, None).await?;
        for ev in v["items"].as_array().into_iter().flatten() {
            let (Some(nid), Some(eid)) = (ev["extendedProperties"]["private"]["notesId"].as_str(), ev["id"].as_str()) else {
                continue;
            };
            if existentes.contains_key(nid) {
                sobrantes.push(eid.to_string()); // duplicado
            } else {
                existentes.insert(nid.to_string(), ev.clone());
            }
        }
        pagina = v["nextPageToken"].as_str().map(String::from);
        if pagina.is_none() {
            break;
        }
    }

    let mut res = Resultado::default();
    let mut aviso = cfg.aviso.unwrap_or(AVISO_MISMO_DIA);
    for e in &eventos {
        let actual = existentes.remove(&e.id);
        if let Some(ev) = &actual {
            if !difiere(ev, &cuerpo_evento(e, aviso)) {
                continue;
            }
        }
        let (metodo, url) = match &actual {
            Some(ev) => (reqwest::Method::PUT, format!("{base}/{}", enc(ev["id"].as_str().unwrap_or_default()))),
            None => (reqwest::Method::POST, base.clone()),
        };
        let mut r = api(&t, metodo.clone(), &url, &[], Some(&cuerpo_evento(e, aviso))).await;
        // Si Google no acepta el aviso de las 9:00, se usa el de las 0:00 y se recuerda.
        if r.as_ref().is_err_and(|m| m.contains("eminder")) && aviso != AVISO_RESPALDO {
            aviso = AVISO_RESPALDO;
            r = api(&t, metodo, &url, &[], Some(&cuerpo_evento(e, aviso))).await;
        }
        r?;
        if actual.is_some() {
            res.actualizados += 1;
        } else {
            res.creados += 1;
        }
    }
    if cfg.aviso != Some(aviso) {
        cfg.aviso = Some(aviso);
        guardar(&app, &cfg)?;
    }

    // Eventos de notas que ya no existen.
    for eid in existentes.values().filter_map(|ev| ev["id"].as_str().map(String::from)).chain(sobrantes) {
        api(&t, reqwest::Method::DELETE, &format!("{base}/{}", enc(&eid)), &[], None).await?;
        res.borrados += 1;
    }
    Ok(res)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev() -> EventoNota {
        EventoNota {
            id: "n1".into(),
            summary: "Tarjeta · $ 1.000,00".into(),
            description: "Cuota 1 de 3".into(),
            date: "2026-10-09".into(),
            end: "2026-10-10".into(),
            reminder: true,
        }
    }

    #[test]
    fn igual_no_difiere() {
        let d = cuerpo_evento(&ev(), AVISO_MISMO_DIA);
        assert!(!difiere(&d, &d));
    }

    #[test]
    fn cambio_de_fecha_o_aviso_difiere() {
        let d = cuerpo_evento(&ev(), AVISO_MISMO_DIA);
        let mut otra = ev();
        otra.date = "2026-11-09".into();
        assert!(difiere(&cuerpo_evento(&otra, AVISO_MISMO_DIA), &d));
        let mut sin_aviso = ev();
        sin_aviso.reminder = false;
        assert!(difiere(&cuerpo_evento(&sin_aviso, AVISO_MISMO_DIA), &d));
    }

    #[test]
    fn google_sin_overrides_equivale_a_sin_aviso() {
        // Google omite "overrides" cuando la lista está vacía.
        let mut e = ev();
        e.reminder = false;
        let deseado = cuerpo_evento(&e, AVISO_MISMO_DIA);
        let mut de_google = deseado.clone();
        de_google["reminders"] = json!({ "useDefault": false });
        assert!(!difiere(&de_google, &deseado));
    }
}
