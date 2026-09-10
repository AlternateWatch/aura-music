use tauri_plugin_opener::OpenerExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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