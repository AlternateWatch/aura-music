mod discord;
#[cfg(windows)]
mod thumbbar;
use tauri::Manager;

/// Muestra y enfoca la ventana principal al abrir una 2ª instancia.
#[cfg(desktop)]
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Busca una versión nueva en GitHub Releases y pregunta si instalarla.
#[cfg(desktop)]
fn check_for_updates(app: tauri::AppHandle) {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    use tauri_plugin_updater::UpdaterExt;

    tauri::async_runtime::spawn(async move {
        let updater = match app.updater() {
            Ok(u) => u,
            Err(e) => {
                log::warn!("Updater no disponible: {}", e);
                return;
            }
        };

        match updater.check().await {
            Ok(Some(update)) => {
                let accepted = app
                    .dialog()
                    .message(format!(
                        "Hay una nueva versión de Aura ({}). ¿Quieres instalarla ahora?",
                        update.version
                    ))
                    .title("Actualización disponible")
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "Instalar".to_string(),
                        "Más tarde".to_string(),
                    ))
                    .blocking_show();

                if accepted {
                    match update.download_and_install(|_, _| {}, || {}).await {
                        Ok(_) => app.restart(),
                        Err(e) => log::error!("Error instalando la actualización: {}", e),
                    }
                }
            }
            Ok(None) => {}
            Err(e) => log::warn!("No se pudo comprobar actualizaciones: {}", e),
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Instancia única: debe registrarse el primero. Si abres Aura otra vez,
    // se enfoca la ventana que ya estaba abierta.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        show_main_window(app);
    }));

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    let builder = builder
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
        ]);

    #[cfg(not(windows))]
    let builder = builder.invoke_handler(tauri::generate_handler![discord::update_discord_rpc]);

    builder
        .setup(|app| {
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                thumbbar::init(app.handle(), &window);
            }

            #[cfg(desktop)]
            check_for_updates(app.handle().clone());

            Ok(())
        })
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
