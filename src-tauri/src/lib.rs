// Tauri desktop shell. We don't expose extra IPC commands — the entire
// game runs in the embedded webview against a remote Cloudflare server.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|_app| {
            // Hook point: if we later add Steamworks SDK integration we can
            // initialise it here. See STEAM_CHECKLIST.md for the steps.
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
