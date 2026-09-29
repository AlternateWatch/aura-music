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

/// Extrae el código de sesión de un enlace aura://join/CODIGO o aura://join?code=CODIGO,
/// y de paso admite que llegue como https://aura.basildo.me/?join=CODIGO por si acaso.
fn extract_join_code(url: &str) -> Option<String> {
    let after_scheme = url.split("://").nth(1).unwrap_or("");
    let (path, query) = match after_scheme.split_once('?') {
        Some((p, q)) => (p, Some(q)),
        None => (after_scheme, None),
    };

    if let Some(code) = path.strip_prefix("join/") {
        let code = code.trim_matches('/');
        if !code.is_empty() {
            return Some(code.to_string());
        }
    }

    query.and_then(|q| {
        q.split('&').find_map(|pair| {
            let (k, v) = pair.split_once('=')?;
            if k == "code" || k == "join" {
                Some(v.to_string())
            } else {
                None
            }
        })
    })
}

/// Recibido un enlace aura://, lleva la ventana a la sesión correspondiente.
/// La ventana ya está cargando https://aura.basildo.me, así que basta con
/// cambiar la URL en el propio navegador embebido (no hace falta reiniciar nada).
#[cfg(desktop)]
fn handle_deep_link(app: &tauri::AppHandle, url: &str) {
    log::info!("Deep link recibido: {}", url);
    show_main_window(app);

    let Some(code) = extract_join_code(url) else {
        log::warn!("Deep link sin código de sesión: {}", url);
        return;
    };

    if let Some(window) = app.get_webview_window("main") {
        let target = format!("https://{}/?join={}", "aura.basildo.me", code);
        let script = format!(
            "window.location.href = {};",
            serde_json::to_string(&target).unwrap_or_default()
        );
        let _ = window.eval(&script);
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
    // Si Windows abre un enlace aura:// mientras Aura ya está abierta, el sistema
    // lanza una "segunda instancia" pasando el enlace como argumento: hay que
    // leerlo aquí (single-instance debe registrarse el primero de todos).
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        show_main_window(app);
        if let Some(url) = args.iter().find(|a| a.starts_with("aura://")) {
            handle_deep_link(app, url);
        }
    }));

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_deep_link::init());

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build());

    // Guarda los avisos (log::warn!, log::error!...) en un archivo, para poder
    // ver qué ha pasado aunque no haya ningún diálogo en pantalla.
    let builder = builder.plugin(
        tauri_plugin_log::Builder::new()
            .level(log::LevelFilter::Info)
            .build(),
    );

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

            // Registro del esquema aura:// en Windows. Se repite en cada arranque
            // porque no cuesta nada y así queda bien aunque la instalación previa
            // se hiciera con una versión anterior que aún no lo registraba.
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(e) = app.deep_link().register("aura") {
                    log::warn!("No se pudo registrar el esquema aura://: {}", e);
                }

                // Enlace con el que se pudo haber abierto la app por primera vez.
                if let Ok(Some(urls)) = app.deep_link().get_current() {
                    let handle = app.handle().clone();
                    for url in urls {
                        handle_deep_link(&handle, url.as_str());
                    }
                }

                // Enlaces que lleguen mientras la app ya está en marcha.
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        handle_deep_link(&handle, url.as_str());
                    }
                });
            }

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
