use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;
use tauri::State;

const DISCORD_CLIENT_ID: &str = "1554039902914748458";

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

fn apply(
    client: &mut DiscordIpcClient,
    title: &str,
    artist: &str,
    is_playing: bool,
) -> Result<(), String> {
    if !is_playing {
        return client
            .clear_activity()
            .map_err(|e| format!("clear_activity falló: {}", e));
    }

    let details = if title.is_empty() { "Navegando por AURA".to_string() } else { title.to_string() };
    let state_str = if artist.is_empty() { "Aura Music Player".to_string() } else { format!("por {}", artist) };

    client
        .set_activity(
            activity::Activity::new()
                .details(&details)
                .state(&state_str),
        )
        .map_err(|e| format!("set_activity falló: {}", e))
}

/// Devuelve Err(mensaje) para que el error se vea en la consola de la web
/// (console.error("Error actualizando Discord RPC:", ...)).
#[tauri::command]
pub fn update_discord_rpc(
    state: State<'_, DiscordState>,
    title: String,
    artist: String,
    is_playing: bool,
) -> Result<(), String> {
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

    if apply(client, &title, &artist, is_playing).is_err() {
        // Discord se cerró o se desconectó: reintentamos con una conexión nueva.
        *guard = None;
        let mut new_client = connect()?;
        apply(&mut new_client, &title, &artist, is_playing)?;
        *guard = Some(new_client);
    }

    Ok(())
}
