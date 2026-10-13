use std::fs;

/// Si existe `google_client.json` (el JSON del cliente OAuth «App de escritorio» descargado de
/// Google Cloud), sus credenciales quedan dentro de la app y el usuario solo toca «Conectar».
/// El archivo está en .gitignore: nunca se sube al repositorio.
fn credenciales_google() {
    const ARCHIVO: &str = "google_client.json";
    println!("cargo:rerun-if-changed={ARCHIVO}");
    let Ok(texto) = fs::read_to_string(ARCHIVO) else { return };
    let v: serde_json::Value = serde_json::from_str(&texto).expect("google_client.json no es JSON válido");
    let c = v.get("installed").expect("google_client.json tiene que ser de un cliente «App de escritorio»");
    let id = c["client_id"].as_str().expect("falta client_id en google_client.json");
    let secret = c["client_secret"].as_str().expect("falta client_secret en google_client.json");
    println!("cargo:rustc-env=NOTES_GOOGLE_CLIENT_ID={id}");
    println!("cargo:rustc-env=NOTES_GOOGLE_CLIENT_SECRET={secret}");
}

fn main() {
    credenciales_google();
    tauri_build::build()
}
