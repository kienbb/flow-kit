use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use crate::AppState;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AppSettings {
    pub flow_api_key: String,
    pub flow_project_id: String,
    pub rewrite_enabled: bool,
    pub rewrite_endpoint: String,
    pub rewrite_api_key: String,
    pub rewrite_model: String,
    pub image_model: String,
    pub image_aspect_ratio: String,
    pub image_count: u32,
    pub safety_tolerance: u32,
    pub auto_remove_bg: bool,
    pub rembg_path: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            flow_api_key: String::new(),
            flow_project_id: String::new(),
            rewrite_enabled: true,
            rewrite_endpoint: "https://api.openai.com/v1".to_string(),
            rewrite_api_key: String::new(),
            rewrite_model: "gpt-4o-mini".to_string(),
            image_model: "GEM_PIX_2".to_string(),
            image_aspect_ratio: "1:1".to_string(),
            image_count: 1,
            safety_tolerance: 2,
            auto_remove_bg: true,
            rembg_path: "rembg".to_string(),
        }
    }
}

impl AppSettings {
    pub fn settings_path(app: &AppHandle) -> anyhow::Result<PathBuf> {
        let app_dir = app.path().app_config_dir()?;
        fs::create_dir_all(&app_dir)?;
        Ok(app_dir.join("settings.json"))
    }
}

pub fn load_settings_from_disk(app: &AppHandle) -> AppSettings {
    match AppSettings::settings_path(app) {
        Ok(path) => fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok())
            .unwrap_or_default(),
        Err(_) => AppSettings::default(),
    }
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let settings = state.settings.lock().map_err(|e| e.to_string())?;
    Ok(settings.clone())
}

#[tauri::command]
pub fn save_settings(
    settings: AppSettings,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = AppSettings::settings_path(&app).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())?;

    let mut current = state.settings.lock().map_err(|e| e.to_string())?;
    *current = settings;
    Ok(())
}

#[tauri::command]
pub async fn test_connection(
    endpoint: String,
    api_key: String,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let response = state
        .http_client
        .get(format!("{}/models", endpoint))
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    Ok(response.status().is_success())
}

#[tauri::command]
pub async fn fetch_models(
    endpoint: String,
    api_key: String,
    state: State<'_, AppState>,
) -> Result<Vec<ModelInfo>, String> {
    let response = state
        .http_client
        .get(format!("{}/models", endpoint))
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("Failed to fetch models: {}", response.status()));
    }

    let data: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let models = data["data"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|m| {
                    let id = m["id"].as_str()?.to_string();
                    Some(ModelInfo {
                        name: id.clone(),
                        id,
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(models)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModelInfo {
    pub id: String,
    pub name: String,
}
