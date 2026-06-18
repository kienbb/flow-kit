use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;
use crate::AppState;

const FLOW_API_BASE: &str = "https://aisandbox-pa.googleapis.com/v1";

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GenerateRequest {
    pub prompt: String,
    pub grid_size: u32,
    pub aspect_ratio: String,
    pub model: String,
    pub image_count: u32,
    pub safety_tolerance: u32,
    pub reference_image_url: Option<String>,
    pub reference_image_base64: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GenerateResponse {
    pub success: bool,
    pub media_id: Option<String>,
    pub image_url: Option<String>,
    pub prompt_used: String,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn generate_sprite(
    request: GenerateRequest,
    state: State<'_, AppState>,
) -> Result<GenerateResponse, String> {
    let (flow_api_key, flow_project_id) = {
        let settings = state.settings.lock().map_err(|e| e.to_string())?;
        (settings.flow_api_key.clone(), settings.flow_project_id.clone())
    };

    if flow_api_key.is_empty() {
        return Ok(GenerateResponse {
            success: false,
            media_id: None,
            image_url: None,
            prompt_used: request.prompt.clone(),
            error: Some("Flow API key not configured".to_string()),
        });
    }

    let project_id = if flow_project_id.is_empty() {
        return Ok(GenerateResponse {
            success: false,
            media_id: None,
            image_url: None,
            prompt_used: request.prompt.clone(),
            error: Some("Flow Project ID not configured".to_string()),
        });
    } else {
        flow_project_id
    };

    // Build the request payload
    let mut payload = json!({
        "requests": [{
            "prompt": request.prompt,
            "imageModel": request.model,
            "aspectRatio": map_aspect_ratio(&request.aspect_ratio),
            "imageCount": request.image_count,
            "safetySettings": {
                "safetyLevel": "BLOCK_NONE"
            }
        }]
    });
    
    // Add reference image if provided
    if let Some(ref_url) = &request.reference_image_url {
        payload["requests"][0]["imageUrls"] = json!([ref_url]);
    } else if let Some(ref_b64) = &request.reference_image_base64 {
        payload["requests"][0]["imageData"] = json!([{
            "mimeType": "image/png",
            "data": ref_b64
        }]);
    }
    
    let url = format!(
        "{}/projects/{}/flowMedia:batchGenerateImages",
        FLOW_API_BASE, project_id
    );
    
    let response = state
        .http_client
        .post(&url)
        .header("Authorization", format!("Bearer {}", flow_api_key))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    
    let status = response.status();
    let response_data: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    
    if !status.is_success() {
        return Ok(GenerateResponse {
            success: false,
            media_id: None,
            image_url: None,
            prompt_used: request.prompt,
            error: Some(format!("API error {}: {:?}", status, response_data)),
        });
    }
    
    // Extract media ID from response
    let media_id = response_data["responses"]
        .get(0)
        .and_then(|r| r["mediaId"].as_str())
        .map(|s| s.to_string());
    
    let image_url = if let Some(id) = &media_id {
        Some(format!("{}/media/{}", FLOW_API_BASE, id))
    } else {
        None
    };
    
    let has_media_id = media_id.is_some();
    Ok(GenerateResponse {
        success: has_media_id,
        media_id,
        image_url,
        prompt_used: request.prompt,
        error: if !has_media_id {
            Some("No media ID in response".to_string())
        } else {
            None
        },
    })
}

#[tauri::command]
pub async fn download_image(media_id: String, state: State<'_, AppState>) -> Result<Vec<u8>, String> {
    let flow_api_key = {
        let settings = state.settings.lock().map_err(|e| e.to_string())?;
        settings.flow_api_key.clone()
    };

    let url = format!("{}/media/{}", FLOW_API_BASE, media_id);

    let response = state
        .http_client
        .get(&url)
        .header("Authorization", format!("Bearer {}", flow_api_key))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    
    if !response.status().is_success() {
        return Err(format!("Download failed: {}", response.status()));
    }
    
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    Ok(bytes.to_vec())
}

#[tauri::command]
pub async fn upload_image(image_data: Vec<u8>, mime_type: String) -> Result<String, String> {
    // For now, return base64 data URL
    let base64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &image_data);
    Ok(format!("data:{};base64,{}", mime_type, base64))
}

fn map_aspect_ratio(ratio: &str) -> &str {
    match ratio {
        "1:1" | "square" => "IMAGE_ASPECT_RATIO_SQUARE",
        "16:9" | "landscape" => "IMAGE_ASPECT_RATIO_LANDSCAPE",
        "9:16" | "portrait" => "IMAGE_ASPECT_RATIO_PORTRAIT",
        _ => "IMAGE_ASPECT_RATIO_SQUARE",
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BridgeStatus {
    pub connected: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn check_nano_banana_bridge() -> Result<BridgeStatus, String> {
    let client = reqwest::Client::new();
    let response = client
        .get("http://localhost:8787/health")
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await;

    match response {
        Ok(resp) => {
            if resp.status().is_success() {
                Ok(BridgeStatus {
                    connected: true,
                    version: None,
                    error: None,
                })
            } else {
                Ok(BridgeStatus {
                    connected: false,
                    version: None,
                    error: Some(format!("HTTP {}", resp.status())),
                })
            }
        }
        Err(e) => {
            Ok(BridgeStatus {
                connected: false,
                version: None,
                error: Some(e.to_string()),
            })
        }
    }
}
