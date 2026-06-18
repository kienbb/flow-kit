// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Mutex;
use tauri::Manager;

mod api;
mod background_removal;
mod settings;

pub struct AppState {
    pub settings: Mutex<settings::AppSettings>,
    pub http_client: reqwest::Client,
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            let loaded = settings::load_settings_from_disk(&app.handle());
            app.manage(AppState {
                settings: Mutex::new(loaded),
                http_client: reqwest::Client::new(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::save_settings,
            settings::test_connection,
            settings::fetch_models,
            api::generate_sprite,
            api::download_image,
            api::upload_image,
            api::check_nano_banana_bridge,
            background_removal::remove_background,
            background_removal::check_rembg_available,
            background_removal::remove_background_from_bytes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
