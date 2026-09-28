use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;
use tauri::State;

const DISCORD_CLIENT_ID: &str = "1554039902914748458";

/// En discord-rich-presence 1.x, `DiscordIpcClient::new` devuelve el cliente
/// directamente (no un Result); lo que puede fallar es `connect()`.
/// El cliente se crea de forma perezosa: así, si Discord no estaba abierto al
/// arrancar Aura, se conecta en cuanto empieza a sonar una canción.
pub struct DiscordState(Mutex<Option<DiscordIpcClient>>);

impl Default for DiscordState {
    fn default() -> Self {
        DiscordState(Mutex::new(None))
    }
}

fn connect() -> Option<DiscordIpcClient> {
    let mut client = DiscordIpcClient::new(DISCORD_CLIENT_ID);
    client.connect().ok()?;
    Some(client)
}

fn apply(
    client: &mut DiscordIpcClient,
    title: &str,
    artist: &str,
    is_playing: bool,
) -> bool {
    if !is_playing {
        return client.clear_activity().is_ok();
    }

    let details = if title.is_empty() { "Navegando por AURA".to_string() } else { title.to_string() };
    let state_str = if artist.is_empty() { "Aura Music Player".to_string() } else { format!("por {}", artist) };

    client.set_activity(
        activity::Activity::new()
            .details(&details)
            .state(&state_str),
    )
    .is_ok()
}

#[tauri::command]
pub fn update_discord_rpc(
    state: State<'_, DiscordState>,
    title: String,
    artist: String,
    is_playing: bool,
) {
    let Ok(mut guard) = state.0.lock() else { return };

    // Sin cliente y sin nada que mostrar: no hace falta conectar.
    if guard.is_none() {
        if !is_playing {
            return;
        }
        *guard = connect();
    }

    let Some(client) = guard.as_mut() else { return };

    if !apply(client, &title, &artist, is_playing) {
        // Discord se cerró o se desconectó: descartamos el cliente y
        // reintentamos una vez con una conexión nueva.
        *guard = connect();
        if let Some(client) = guard.as_mut() {
            if !apply(client, &title, &artist, is_playing) {
                *guard = None;
            }
        }
    }
}
