use serde::{Deserialize, Serialize};
use std::process::Command;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn unique_temp_name(suffix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let seq = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("falsprite_{}_{}_{}", std::process::id(), nanos, seq) + suffix
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RemoveBgResult {
    pub success: bool,
    pub output_path: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn check_rembg_available() -> Result<bool, String> {
    // Check if rembg is installed
    let output = Command::new("rembg")
        .arg("--version")
        .output();
    
    match output {
        Ok(result) => Ok(result.status.success()),
        Err(_) => {
            // Also check for Python module
            let python_check = Command::new("python")
                .args(["-c", "import rembg; print('ok')"])
                .output();
            
            match python_check {
                Ok(result) => Ok(result.status.success()),
                Err(_) => {
                    // Try python3
                    let python3_check = Command::new("python3")
                        .args(["-c", "import rembg; print('ok')"])
                        .output();
                    
                    match python3_check {
                        Ok(result) => Ok(result.status.success()),
                        Err(_) => Ok(false),
                    }
                }
            }
        }
    }
}

#[tauri::command]
pub async fn remove_background(
    input_path: String,
    output_path: String,
    rembg_path: String,
) -> Result<RemoveBgResult, String> {
    // Validate input file exists
    if !Path::new(&input_path).exists() {
        return Ok(RemoveBgResult {
            success: false,
            output_path: None,
            error: Some(format!("Input file not found: {}", input_path)),
        });
    }
    
    let result = if rembg_path == "rembg" || rembg_path.is_empty() {
        // Try system rembg command
        Command::new("rembg")
            .args([
                "i",
                "-m", "u2net",
                "-a", "erode",
                "-ae", "15",
                &input_path,
                &output_path,
            ])
            .output()
    } else {
        // Use custom path
        Command::new(&rembg_path)
            .args([
                "i",
                "-m", "u2net",
                "-a", "erode",
                "-ae", "15",
                &input_path,
                &output_path,
            ])
            .output()
    };
    
    match result {
        Ok(output) => {
            if output.status.success() {
                if Path::new(&output_path).exists() {
                    Ok(RemoveBgResult {
                        success: true,
                        output_path: Some(output_path),
                        error: None,
                    })
                } else {
                    Ok(RemoveBgResult {
                        success: false,
                        output_path: None,
                        error: Some("Output file was not created".to_string()),
                    })
                }
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Ok(RemoveBgResult {
                    success: false,
                    output_path: None,
                    error: Some(format!("rembg failed: {}", stderr)),
                })
            }
        }
        Err(e) => {
            // Try fallback: Python module
            let python_result = Command::new("python")
                .args([
                    "-c",
                    &format!(
                        r#"
import sys
try:
    from rembg import remove
    from PIL import Image
    input_img = Image.open('{}')
    output_img = remove(input_img)
    output_img.save('{}')
    print('success')
except Exception as e:
    print(f'error: {{e}}')
    sys.exit(1)
                        "#,
                        input_path.replace("'", "\\'"),
                        output_path.replace("'", "\\'")
                    ),
                ])
                .output();
            
            match python_result {
                Ok(py_output) => {
                    if py_output.status.success() {
                        Ok(RemoveBgResult {
                            success: true,
                            output_path: Some(output_path),
                            error: None,
                        })
                    } else {
                        let py_stderr = String::from_utf8_lossy(&py_output.stderr);
                        Ok(RemoveBgResult {
                            success: false,
                            output_path: None,
                            error: Some(format!("Python rembg failed: {}. Original error: {}", py_stderr, e)),
                        })
                    }
                }
                Err(py_e) => {
                    Ok(RemoveBgResult {
                        success: false,
                        output_path: None,
                        error: Some(format!("Failed to run rembg: {}. Python fallback also failed: {}", e, py_e)),
                    })
                }
            }
        }
    }
}

#[tauri::command]
pub async fn remove_background_from_bytes(
    image_data: Vec<u8>,
    rembg_path: String,
) -> Result<Vec<u8>, String> {
    let temp_dir = std::env::temp_dir();
    let input_path = temp_dir.join(unique_temp_name("_input.png"));
    let output_path = temp_dir.join(unique_temp_name("_output.png"));
    
    std::fs::write(&input_path, &image_data).map_err(|e| e.to_string())?;
    
    let result = remove_background(
        input_path.to_string_lossy().to_string(),
        output_path.to_string_lossy().to_string(),
        rembg_path,
    ).await?;
    
    if result.success {
        let output_data = std::fs::read(&output_path).map_err(|e| e.to_string())?;
        
        // Cleanup
        let _ = std::fs::remove_file(&input_path);
        let _ = std::fs::remove_file(&output_path);
        
        Ok(output_data)
    } else {
        Err(result.error.unwrap_or_else(|| "Unknown error".to_string()))
    }
}
