mod discord;
#[cfg(windows)]
mod thumbbar;
#[cfg(windows)]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(discord::DiscordState::default());

    // Solo puede haber UN invoke_handler: el último sobrescribe al anterior,
    // así que aquí se registran todos los comandos juntos.
    #[cfg(windows)]
    let builder = builder
        .manage(thumbbar::ThumbbarState::default())
        .invoke_handler(tauri::generate_handler![
            discord::update_discord_rpc,
            thumbbar::thumbbar_set_playing
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                thumbbar::init(app.handle(), &window);
            }
            Ok(())
        });

    #[cfg(not(windows))]
    let builder = builder.invoke_handler(tauri::generate_handler![discord::update_discord_rpc]);

    builder
        .on_page_load(|window, _payload| {
            // Inyecta soporte nativo para que cualquier window.open o target="_blank"
            // llame directamente al comando de apertura de Windows
            let _ = window.eval(r#"
                window.__TAURI_OPEN_URL__ = function(url) {
                    if (window.__TAURI_INTERNALS__) {
                        window.__TAURI_INTERNALS__.invoke('plugin:opener|open_url', { url: url });
                    } else {
                        window.location.href = url;
                    }
                };
            "#);
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
