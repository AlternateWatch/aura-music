fn main() {
    // Los comandos propios se declaran aquí para poder darles permiso
    // explícito en capabilities (necesario cuando la web es remota).
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new()
                .commands(&["update_discord_rpc", "thumbbar_set_playing"]),
        ),
    )
    .expect("failed to run tauri-build");
}
