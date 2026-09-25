use tauri_plugin_opener::OpenerExt;

#[cfg(windows)]
mod thumbbar;
#[cfg(windows)]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init());

    #[cfg(windows)]
    let builder = builder
        .manage(thumbbar::ThumbbarState::default())
        .invoke_handler(tauri::generate_handler![thumbbar::thumbbar_set_playing])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                thumbbar::init(app.handle(), &window);
            }
            Ok(())
        });

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