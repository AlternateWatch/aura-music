use discord_rich_presence::{
    activity::{Activity, ActivityType, Assets, Button, Timestamps},
    DiscordIpc, DiscordIpcClient,
};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

const DISCORD_CLIENT_ID: &str = "1554039902914748458";
const AURA_URL: &str = "https://aura.basildo.me";

/// El cliente se crea de forma perezosa: así, si Discord no estaba abierto al
/// arrancar Aura, se conecta en cuanto empieza a sonar una canción.
pub struct DiscordState(Mutex<Option<DiscordIpcClient>>);

impl Default for DiscordState {
    fn default() -> Self {
        DiscordState(Mutex::new(None))
    }
}

fn connect() -> Result<DiscordIpcClient, String> {
    let mut client = DiscordIpcClient::new(DISCORD_CLIENT_ID);
    client
        .connect()
        .map_err(|e| format!("No se pudo conectar con Discord: {}", e))?;
    Ok(client)
}

/// Discord exige textos de entre 2 y 128 caracteres.
fn fit(s: &str) -> String {
    let mut out: String = s.chars().take(128).collect();
    if out.chars().count() < 2 {
        out.push(' ');
    }
    out
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

struct Track<'a> {
    title: &'a str,
    artist: &'a str,
    album: &'a str,
    cover_url: &'a str,
    position_ms: u64,
    duration_ms: u64,
}

fn apply(client: &mut DiscordIpcClient, track: &Track, is_playing: bool) -> Result<(), String> {
    if !is_playing {
        return client
            .clear_activity()
            .map_err(|e| format!("clear_activity falló: {}", e));
    }

    let details = fit(if track.title.is_empty() { "Aura" } else { track.title });
    let state = fit(if track.artist.is_empty() { "Artista desconocido" } else { track.artist });
    let album = fit(track.album);

    let mut assets = Assets::new();
    // Discord acepta una URL https como imagen (máx. 256 caracteres).
    if track.cover_url.starts_with("http") && track.cover_url.len() <= 256 {
        assets = assets.large_image(track.cover_url);
    }
    if !track.album.is_empty() {
        assets = assets.large_text(&album);
    }

    let mut activity = Activity::new()
        .activity_type(ActivityType::Listening) // "Escuchando Aura" en vez de "Jugando a"
        .details(&details)
        .state(&state)
        .assets(assets)
        .buttons(vec![Button::new("Escuchar en Aura", AURA_URL)]);

    // Barra de progreso estilo Spotify: inicio y fin en segundos (Unix).
    if track.duration_ms > 0 {
        let start = now_secs() - (track.position_ms / 1000) as i64;
        let end = start + (track.duration_ms / 1000) as i64;
        activity = activity.timestamps(Timestamps::new().start(start).end(end));
    }

    client
        .set_activity(activity)
        .map_err(|e| format!("set_activity falló: {}", e))
}

/// Devuelve Err(mensaje) para que el error se vea en la consola de la web.
#[tauri::command]
pub fn update_discord_rpc(
    state: State<'_, DiscordState>,
    title: String,
    artist: String,
    album: String,
    cover_url: String,
    position_ms: u64,
    duration_ms: u64,
    is_playing: bool,
) -> Result<(), String> {
    let track = Track {
        title: &title,
        artist: &artist,
        album: &album,
        cover_url: &cover_url,
        position_ms,
        duration_ms,
    };

    let mut guard = state
        .0
        .lock()
        .map_err(|_| "El estado de Discord está bloqueado".to_string())?;

    if guard.is_none() {
        if !is_playing {
            return Ok(());
        }
        *guard = Some(connect()?);
    }

    let Some(client) = guard.as_mut() else { return Ok(()) };

    if apply(client, &track, is_playing).is_err() {
        // Discord se cerró o se desconectó: reintentamos con una conexión nueva.
        *guard = None;
        let mut new_client = connect()?;
        apply(&mut new_client, &track, is_playing)?;
        *guard = Some(new_client);
    }

    Ok(())
}
