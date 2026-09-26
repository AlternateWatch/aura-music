// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;
use tauri::State;

// Estructura para mantener el cliente de Discord seguro en segundo plano
struct DiscordState {
    client: Mutex<Option<DiscordIpcClient>>,
}

// Comando de Tauri que recibe la info desde React y la manda a Discord
#[tauri::command]
fn update_discord_rpc(
    state: State<'_, DiscordState>,
    title: String,
    artist: String,
    is_playing: bool,
) {
    if let Ok(mut client_lock) = state.client.lock() {
        if let Some(client) = client_lock.as_mut() {
            if !is_playing {
                let _ = client.clear_activity();
                return;
            }

            let details = if title.is_empty() { "Navegando por AURA".to_string() } else { title };
            let state_str = if artist.is_empty() { "Aura Music Player".to_string() } else { format!("por {}", artist) };

            let activity = activity::Activity::new()
                .details(&details)
                .state(&state_str);

            let _ = client.set_activity(activity);
        }
    }
}

fn main() {
    // Intentamos conectar con Discord al arrancar la app de escritorio
    let discord_client = match DiscordIpcClient::new("1204134988775440405") {
        Ok(mut client) => {
            if client.connect().is_ok() {
                Some(client)
            } else {
                None
            }
        }
        Err(_) => None,
    };

    tauri::Builder::default()
        .manage(DiscordState {
            client: Mutex::new(discord_client),
        })
        .invoke_handler(tauri::generate_handler![update_discord_rpc])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}