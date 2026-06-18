// Nano Banana API Gateway client for falsprite
// Replaces fal.ai API calls with Chrome Extension API Gateway

export const NANO_BANANA_EXTENSION_ID = "your-extension-id-here"; // Will be set from UI

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function validateHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Call Nano Banana API Gateway via Chrome Extension messaging
 * This function works in browser context (frontend)
 */
export async function callNanoBananaAPI(action, params = {}, timeoutMs = 300000) {
  const extensionId = getExtensionId();
  
  if (!extensionId) {
    return { ok: false, error: "Extension ID not configured. Please set your Nano Banana Bridge Extension ID." };
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ ok: false, error: "Request timeout" });
    }, timeoutMs);

    try {
      chrome.runtime.sendMessage(extensionId, { action, ...params }, (response) => {
        clearTimeout(timeout);
        
        if (chrome.runtime.lastError) {
          resolve({ 
            ok: false, 
            error: `Extension error: ${chrome.runtime.lastError.message}. Make sure the extension is installed and enabled.` 
          });
          return;
        }

        if (!response) {
          resolve({ ok: false, error: "No response from extension" });
          return;
        }

        if (response.error) {
          resolve({ ok: false, error: response.error, data: response });
          return;
        }

        resolve({ ok: true, data: response.data || response });
      });
    } catch (error) {
      clearTimeout(timeout);
      resolve({ ok: false, error: `Failed to send message: ${error.message}` });
    }
  });
}

/**
 * Generate images using Nano Banana API
 */
export async function generateImages(params) {
  const result = await callNanoBananaAPI("generate", {
    prompt: params.prompt,
    aspectRatio: params.aspectRatio || "1:1",
    count: params.count || 1,
    model: params.model || "nano-banana-pro",
    style: params.style,
    seed: params.seed,
    negativePrompt: params.negativePrompt
  });

  if (!result.ok) {
    return result;
  }

  // Extract image URLs from media IDs
  const mediaIds = result.data?.mediaIds || [];
  const imageUrls = [];
  
  for (const mediaId of mediaIds) {
    const downloadResult = await callNanoBananaAPI("download-url", { mediaId });
    if (downloadResult.ok && downloadResult.data?.url) {
      imageUrls.push(downloadResult.data.url);
    }
  }

  return {
    ok: true,
    data: {
      ...result.data,
      images: imageUrls,
      mediaIds
    }
  };
}

/**
 * Download image as blob from Nano Banana
 */
export async function downloadImage(mediaId) {
  const result = await callNanoBananaAPI("download", { 
    mediaId, 
    format: "base64" 
  });

  if (!result.ok) {
    return result;
  }

  // Convert base64 to blob
  const base64 = result.data?.base64;
  if (!base64) {
    return { ok: false, error: "No image data received" };
  }

  const mimeType = result.data?.mimeType || "image/png";
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mimeType });

  return {
    ok: true,
    data: {
      blob,
      mimeType,
      size: result.data?.size || blob.size,
      url: URL.createObjectURL(blob)
    }
  };
}

/**
 * Check extension status
 */
export async function checkExtensionStatus() {
  return await callNanoBananaAPI("status", {}, 10000);
}

/**
 * Get available models
 */
export async function getModels() {
  return await callNanoBananaAPI("models", {}, 10000);
}

/**
 * Set active project
 */
export async function setProject(projectId) {
  return await callNanoBananaAPI("set-project", { projectId }, 10000);
}

// Extension ID management
let _extensionId = "";

export function setExtensionId(id) {
  _extensionId = id.trim();
  if (typeof window !== "undefined") {
    window.localStorage.setItem("nano_banana_extension_id", _extensionId);
  }
}

export function getExtensionId() {
  if (!_extensionId && typeof window !== "undefined") {
    _extensionId = window.localStorage.getItem("nano_banana_extension_id") || "";
  }
  return _extensionId;
}

export function clearExtensionId() {
  _extensionId = "";
  if (typeof window !== "undefined") {
    window.localStorage.removeItem("nano_banana_extension_id");
  }
}

// Prompt building utilities (kept from original)
const NUM_WORDS = { 2: "two", 3: "three", 4: "four", 5: "five", 6: "six" };

export function buildSpritePrompt(basePrompt, gridSize = 4) {
  const w = NUM_WORDS[gridSize] || "four";
  return [
    "STRICT TECHNICAL REQUIREMENTS FOR THIS IMAGE:",
    "",
    `FORMAT: A single image containing a ${w}-by-${w} grid of equally sized cells.`,
    "Every cell must be the exact same dimensions, perfectly aligned, with no gaps or overlap.",
    "",
    "FORBIDDEN: Absolutely no text, no numbers, no letters, no digits, no labels,",
    "no watermarks, no signatures, no UI elements anywhere in the image. The image must",
    "contain ONLY the character illustrations in the grid cells and nothing else.",
    "",
    "CONSISTENCY: The exact same single character must appear in every cell.",
    "Same proportions, same art style, same level of detail, same camera angle throughout.",
    "Isometric three-quarter view. Full body visible head to toe in every cell.",
    "Strong clean silhouette against a plain solid flat-color background.",
    "",
    "ANIMATION FLOW: The cells read left-to-right, top-to-bottom, like reading a page.",
    "This is one continuous motion sequence. Each cell shows the next moment in the movement.",
    "The transition between the last cell of one row and the first cell of the next row",
    `must be just as smooth as transitions within a row — no jumps, no resets.`,
    `Each row contains ${w} phases of the motion. The very last cell loops back seamlessly`,
    "to the very first cell.",
    "",
    "MOTION QUALITY: Show real weight and physics. Bodies shift weight between feet.",
    "Arms counterbalance legs. Torsos rotate into actions. Follow-through on every movement.",
    "No stiff poses — every cell must feel like a freeze-frame of fluid motion.",
    "For locomotion (walk/run): strictly alternate left and right legs — one leg extends forward",
    "while the other pushes behind. Each frame must show a clearly different leg position.",
    "Never repeat the same pose twice in a row.",
    "",
    "CHARACTER AND ANIMATION DIRECTION:",
    basePrompt
  ].join("\n");
}

export function buildRewriteSystemPrompt(gridSize) {
  const w = NUM_WORDS[gridSize] || "four";
  return [
    "You are an animation director and character designer for a sprite sheet pipeline.",
    "Given a character concept, you MUST return exactly two sections, nothing else:",
    "",
    "CHARACTER: A vivid description of the character's appearance — body type, armor, weapons, colors, silhouette, art style. Be extremely specific and visual.",
    "",
    `CHOREOGRAPHY: A ${w}-beat continuous animation loop that showcases this specific character's personality and abilities. Each beat is one row of the sheet. The last beat must transition seamlessly back into the first.`,
    "For each beat, describe the body position, weight distribution, limb placement, and motion arc in one sentence.",
    "The choreography must feel natural and unique to THIS character — a mage animates differently than a knight, a dancer differently than a berserker.",
    "",
    "RULES:",
    "- Never use numbers or digits anywhere.",
    "- Never mention grids, pixels, frames, cells, or image generation.",
    "- Never mention sprite sheets or technical terms.",
    "- Write as if directing a real actor through a motion capture session.",
    `- The ${w} beats must form one fluid, looping performance.`,
    "- For locomotion (walk/run): strictly alternate left and right legs in each beat.",
    "  Describe exact limb positions — which leg is forward, which is pushing off,",
    "  which arm is swinging forward. Every beat must show a distinctly different leg configuration."
  ].join("\n");
}

export function makeDefaultPrompt() {
  const subjects = ["baby dragon", "crystal fox", "tiny samurai cat", "sparkle unicorn", "bamboo panda warrior"];
  const styles = ["clean pixel art", "chibi kawaii", "pastel dreamlike", "cozy storybook", "Studio Ghibli inspired"];
  const subject = subjects[Math.floor(Math.random() * subjects.length)];
  const style = styles[Math.floor(Math.random() * styles.length)];
  return `${subject}, ${style}, isometric action RPG`;
}

export function extractRewrittenPrompt(payload) {
  const candidates = [];
  const push = (v) => { const n = normalizeMessageContent(v); if (n) candidates.push(n); };

  push(payload?.output);
  push(payload?.text);
  push(payload?.result?.output);
  push(payload?.result?.text);
  push(payload?.choices?.[0]?.message?.content);
  push(payload?.output?.choices?.[0]?.message?.content);
  push(payload?.result?.choices?.[0]?.message?.content);

  if (candidates.length > 0) return cleanPromptText(candidates[0]);

  const stack = [payload];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (Array.isArray(current)) { current.forEach(i => stack.push(i)); continue; }
    if (typeof current !== "object") continue;
    for (const [key, value] of Object.entries(current)) {
      if (typeof value === "string" && (key === "text" || key === "content" || key === "output")) {
        const cleaned = cleanPromptText(value);
        if (cleaned.length > 20) return cleaned;
      } else if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }
  return "";
}

function normalizeMessageContent(value) {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value.map(p => (typeof p === "string" ? p : p?.text || p?.content || "")).filter(Boolean).join(" ").trim();
  }
  if (value && typeof value === "object") return (value.text || value.content || "").trim();
  return "";
}

function cleanPromptText(text) {
  return text.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/g, "").trim();
}

export function pickErrorMessage(data, fallback) {
  if (typeof data?.error === "string" && data.error.trim()) return data.error.trim();
  if (typeof data?.raw === "string" && data.raw.trim()) return data.raw.trim();
  return fallback;
}
