import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";

const HISTORY_LIMIT = 16;

function getGridSize() {
  return parseInt(document.getElementById("gridSelect")?.value, 10) || 4;
}

function getTotalFrames(g) {
  return g * g;
}

function makeFrameOrder(g) {
  return Array.from({ length: g * g }, (_, i) => i);
}

const RANDOM_SUBJECTS = [
  "baby dragon",
  "crystal fox",
  "tiny samurai cat",
  "sparkle unicorn",
  "bamboo panda warrior",
  "honey bee ranger",
  "jolly mushroom knight",
  "thunder puppy"
];

const RANDOM_STYLES = [
  "clean pixel art",
  "Studio Ghibli inspired",
  "chibi kawaii",
  "pastel dreamlike",
  "cozy storybook",
  "hand-drawn sketch",
  "retro arcade"
];

const elements = {
  promptInput: document.querySelector("#promptInput"),
  gridSelect: document.querySelector("#gridSelect"),
  generateButton: document.querySelector("#generateButton"),
  surpriseButton: document.querySelector("#surpriseButton"),
  statusText: document.querySelector("#statusText"),
  resultSection: document.querySelector("#resultSection"),
  previewCanvas: document.querySelector("#previewCanvas"),
  frameLabel: document.querySelector("#frameLabel"),
  fpsInput: document.querySelector("#fpsInput"),
  playToggle: document.querySelector("#playToggle"),
  promptText: document.querySelector("#promptText"),
  warningText: document.querySelector("#warningText"),
  downloadSheetButton: document.querySelector("#downloadSheetButton"),
  downloadTransparentButton: document.querySelector("#downloadTransparentButton"),
  downloadGifButton: document.querySelector("#downloadGifButton"),
  importButton: document.querySelector("#importButton"),
  imageFileInput: document.querySelector("#imageFileInput"),
  imagePreview: document.querySelector("#imagePreview"),
  imagePreviewImg: document.querySelector("#imagePreviewImg"),
  removeImageButton: document.querySelector("#removeImageButton"),
  settingsBtn: document.querySelector("#settingsBtn"),
  settingsModal: document.querySelector("#settingsModal"),
  closeSettings: document.querySelector("#closeSettings"),
  saveSettings: document.querySelector("#saveSettings"),
  testConnection: document.querySelector("#testConnection"),
  fetchModelsBtn: document.querySelector("#fetchModelsBtn"),
  // Settings fields
  flowApiKey: document.querySelector("#flowApiKey"),
  flowProjectId: document.querySelector("#flowProjectId"),
  imageModel: document.querySelector("#imageModel"),
  aspectRatio: document.querySelector("#aspectRatio"),
  rewriteEnabled: document.querySelector("#rewriteEnabled"),
  rewriteEndpoint: document.querySelector("#rewriteEndpoint"),
  rewriteApiKey: document.querySelector("#rewriteApiKey"),
  rewriteModel: document.querySelector("#rewriteModel"),
  autoRemoveBg: document.querySelector("#autoRemoveBg"),
  rembgPath: document.querySelector("#rembgPath"),
  rembgStatus: document.querySelector("#rembgStatus"),
  bridgeStatus: document.querySelector("#bridgeStatus"),
};

const state = {
  generating: false,
  generateStartedAt: 0,
  current: {
    promptOriginal: "",
    promptRewritten: "",
    spriteUrl: "",
    transparentSpriteUrl: "",
    gifUrl: "",
    referenceImageUrl: "",
    referenceImageBase64: "",
    gridSize: 4,
    mediaId: ""
  },
  preview: {
    image: null,
    objectUrl: "",
    playIndex: 0,
    playing: true,
    lastTick: 0,
    rafId: 0
  },
  objectUrls: [],
  settings: {}
};

const previewCtx = elements.previewCanvas.getContext("2d", { alpha: false });
previewCtx.imageSmoothingEnabled = false;

// Initialize
loadSettings();
setStatus("Ready.");
drawPlaceholder();
wireEvents();
startAnimationLoop();
checkRembgStatus();
checkBridgeStatus();

function wireEvents() {
  elements.generateButton.addEventListener("click", onGenerate);
  elements.surpriseButton.addEventListener("click", onSurprise);
  elements.playToggle.addEventListener("click", onTogglePlay);
  elements.downloadSheetButton.addEventListener("click", onDownloadSheet);
  elements.downloadTransparentButton.addEventListener("click", onDownloadTransparent);
  elements.downloadGifButton.addEventListener("click", onDownloadGif);
  elements.importButton.addEventListener("click", onImportImage);
  elements.imageFileInput.addEventListener("change", onImageSelected);
  elements.removeImageButton.addEventListener("click", onRemoveImage);
  elements.gridSelect.addEventListener("change", onGridChange);
  
  // Settings
  elements.settingsBtn.addEventListener("click", openSettings);
  elements.closeSettings.addEventListener("click", closeSettingsModal);
  elements.saveSettings.addEventListener("click", saveSettingsHandler);
  elements.testConnection.addEventListener("click", testConnectionHandler);
  elements.fetchModelsBtn.addEventListener("click", fetchModelsHandler);
  
  // Action chips
  document.querySelectorAll(".action-chip").forEach(chip => {
    chip.addEventListener("click", () => onActionChipClick(chip));
  });
  
  document.getElementById("customAction")?.addEventListener("input", updateActionCounter);
  updateActionCounter();
}

function onActionChipClick(chip) {
  const isAuto = chip.dataset.action === "";
  
  if (isAuto) {
    document.querySelectorAll(".action-chip").forEach(c => c.classList.remove("is-active"));
    chip.classList.add("is-active");
  } else {
    const autoChip = document.querySelector('.action-chip[data-action=""]');
    if (autoChip) autoChip.classList.remove("is-active");
    
    if (chip.classList.contains("is-active")) {
      chip.classList.remove("is-active");
      if (getSelectedActions().length === 0 && autoChip) {
        autoChip.classList.add("is-active");
      }
    } else {
      const maxActions = getGridSize();
      if (getSelectedActions().length >= maxActions) {
        const counter = document.getElementById("actionCounter");
        if (counter) {
          counter.style.color = "var(--accent)";
          setTimeout(() => counter.style.color = "", 600);
        }
        return;
      }
      chip.classList.add("is-active");
    }
  }
  
  document.getElementById("customAction").value = "";
  updateActionCounter();
}

function getSelectedActions() {
  const actions = [];
  document.querySelectorAll(".action-chip.is-active").forEach(chip => {
    if (chip.dataset.action) actions.push(chip.dataset.action);
  });
  const custom = document.getElementById("customAction")?.value.trim();
  if (custom) actions.push(custom);
  return actions;
}

function getSelectedAction() {
  const actions = getSelectedActions();
  return actions.length > 0 ? actions.join(", ") : "";
}

function updateActionCounter() {
  const counter = document.getElementById("actionCounter");
  if (!counter) return;
  const g = getGridSize();
  const count = getSelectedActions().length;
  counter.textContent = `${count}/${g} rows`;
  counter.style.color = count >= g ? "var(--accent)" : "";
}

function onGridChange() {
  const g = getGridSize();
  updateActionCounter();
}

async function onImportImage() {
  try {
    const selected = await open({
      multiple: false,
      filters: [{
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "webp"]
      }]
    });
    
    if (selected) {
      const fileData = await readFile(selected);
      const blob = new Blob([fileData]);
      const base64 = await blobToBase64(blob);
      
      state.current.referenceImageBase64 = base64.split(',')[1];
      
      const objectUrl = URL.createObjectURL(blob);
      trackObjectUrl(objectUrl);
      elements.imagePreviewImg.src = objectUrl;
      elements.imagePreview.classList.remove("hidden");
      
      setStatus("Reference image loaded.", "success");
    }
  } catch (error) {
    setStatus(`Failed to load image: ${error.message}`, "error");
  }
}

async function onImageSelected() {
  const file = elements.imageFileInput.files[0];
  if (!file) return;
  
  try {
    const base64 = await fileToBase64(file);
    state.current.referenceImageBase64 = base64.split(',')[1];
    
    const objectUrl = URL.createObjectURL(file);
    trackObjectUrl(objectUrl);
    elements.imagePreviewImg.src = objectUrl;
    elements.imagePreview.classList.remove("hidden");
    
    setStatus("Reference image ready.", "success");
  } catch (error) {
    setStatus(`Image load failed: ${error.message}`, "error");
  }
  
  elements.imageFileInput.value = "";
}

function onRemoveImage() {
  state.current.referenceImageBase64 = "";
  state.current.referenceImageUrl = "";
  elements.imagePreview.classList.add("hidden");
  elements.imagePreviewImg.src = "";
  setStatus("Reference image removed.");
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

function randomPrompt() {
  const subject = RANDOM_SUBJECTS[Math.floor(Math.random() * RANDOM_SUBJECTS.length)];
  const style = RANDOM_STYLES[Math.floor(Math.random() * RANDOM_STYLES.length)];
  return `${subject}, ${style}, isometric action RPG animation`;
}

function onSurprise() {
  elements.promptInput.value = randomPrompt();
}

function onTogglePlay() {
  state.preview.playing = !state.preview.playing;
  elements.playToggle.textContent = state.preview.playing ? "Pause" : "Play";
}

async function onGenerate() {
  if (state.generating && Date.now() - state.generateStartedAt < 5000) {
    return;
  }
  
  if (!state.settings.flow_api_key) {
    setStatus("Please configure Flow API key in Settings.", "error");
    openSettings();
    return;
  }
  
  if (!state.settings.flow_project_id) {
    setStatus("Please configure Flow Project ID in Settings.", "error");
    openSettings();
    return;
  }
  
  let prompt = elements.promptInput.value.trim();
  if (!prompt) {
    prompt = randomPrompt();
    elements.promptInput.value = prompt;
  }
  
  const gridSize = getGridSize();
  state.current.gridSize = gridSize;
  state.generating = true;
  state.generateStartedAt = Date.now();
  elements.generateButton.disabled = true;
  
  setTimeout(() => {
    elements.generateButton.disabled = false;
  }, 5000);
  
  setStatus(`Generating ${gridSize}x${gridSize} sprite sheet...`);
  hideWarnings();
  
  elements.resultSection.classList.remove("hidden");
  elements.promptText.textContent = "building prompt...";
  showCanvasLoader(true);
  
  try {
    const action = getSelectedAction();
    const fullPrompt = action ? `${prompt} — animation: ${action}` : prompt;
    
    // Build sprite prompt
    const spritePrompt = buildSpritePrompt(fullPrompt, gridSize);
    
    // Rewrite prompt if enabled
    let rewrittenPrompt = spritePrompt;
    if (state.settings.rewrite_enabled && state.settings.rewrite_api_key) {
      setStatus("Rewriting prompt with LLM...");
      const rewriteResult = await rewritePrompt(spritePrompt, gridSize);
      if (rewriteResult) {
        rewrittenPrompt = rewriteResult;
      }
    }
    
    elements.promptText.textContent = rewrittenPrompt.substring(0, 200) + "...";
    
    // Generate using Flow API
    const result = await invoke("generate_sprite", {
      request: {
        prompt: rewrittenPrompt,
        grid_size: gridSize,
        aspect_ratio: state.settings.image_aspect_ratio || "1:1",
        model: state.settings.image_model || "GEM_PIX_2",
        image_count: 1,
        safety_tolerance: state.settings.safety_tolerance || 2,
        reference_image_url: state.current.referenceImageUrl || null,
        reference_image_base64: state.current.referenceImageBase64 || null,
      }
    });
    
    if (!result.success) {
      throw new Error(result.error || "Generation failed");
    }
    
    state.current.promptOriginal = prompt;
    state.current.promptRewritten = rewrittenPrompt;
    state.current.mediaId = result.media_id;
    state.current.spriteUrl = result.image_url;
    
    // Download the image
    const imageData = await invoke("download_image", {
      mediaId: result.media_id
    });
    
    const blob = new Blob([new Uint8Array(imageData)]);
    const objectUrl = URL.createObjectURL(blob);
    trackObjectUrl(objectUrl);
    
    // Background removal if enabled
    if (state.settings.auto_remove_bg) {
      setStatus("Removing background...");
      try {
        const bgRemoved = await invoke("remove_background_from_bytes", {
          imageData: Array.from(new Uint8Array(imageData)),
          rembgPath: state.settings.rembg_path || "rembg"
        });
        
        const transparentBlob = new Blob([new Uint8Array(bgRemoved)]);
        const transparentUrl = URL.createObjectURL(transparentBlob);
        trackObjectUrl(transparentUrl);
        state.current.transparentSpriteUrl = transparentUrl;
        
        await loadPreviewImage(transparentUrl);
      } catch (bgError) {
        console.warn("Background removal failed:", bgError);
        state.current.transparentSpriteUrl = "";
        await loadPreviewImage(objectUrl);
        updateWarnings(["Background removal failed. Using original image."]);
      }
    } else {
      state.current.transparentSpriteUrl = "";
      await loadPreviewImage(objectUrl);
    }
    
    resetGifCache();
    showCanvasLoader(false);
    state.preview.playing = true;
    elements.playToggle.textContent = "Pause";
    
    setStatus("Done. Animation ready.", "success");
    
    void appendHistoryAnimation(state.preview.image, rewrittenPrompt);
  } catch (error) {
    showCanvasLoader(false);
    setStatus(error.message, "error");
  } finally {
    state.generating = false;
    elements.generateButton.disabled = false;
  }
}

async function rewritePrompt(prompt, gridSize) {
  try {
    const response = await fetch(`${state.settings.rewrite_endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${state.settings.rewrite_api_key}`
      },
      body: JSON.stringify({
        model: state.settings.rewrite_model,
        messages: [
          {
            role: "system",
            content: buildRewriteSystemPrompt(gridSize)
          },
          {
            role: "user",
            content: `Improve this sprite sheet prompt: ${prompt}`
          }
        ],
        max_tokens: 500,
        temperature: 0.7
      })
    });
    
    if (!response.ok) {
      throw new Error(`Rewrite failed: ${response.status}`);
    }
    
    const data = await response.json();
    return data.choices?.[0]?.message?.content || prompt;
  } catch (error) {
    console.warn("Prompt rewrite failed:", error);
    return null;
  }
}

function buildSpritePrompt(basePrompt, gridSize = 4) {
  const NUM_WORDS = { 2: "two", 3: "three", 4: "four", 5: "five", 6: "six" };
  const w = NUM_WORDS[gridSize] || "four";
  
  return [
    "STRICT TECHNICAL REQUIREMENTS FOR THIS IMAGE:",
    "",
    `FORMAT: A single image containing a ${w}-by-${w} grid of equally sized cells.`,
    "Every cell must be the exact same dimensions, perfectly aligned, with no gaps or overlap.",
    "",
    "FORBIDDEN: Absolutely no text, no numbers, no letters, no digits, no labels,",
    "no watermarks, no signatures, no UI elements anywhere in the image.",
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

function buildRewriteSystemPrompt(gridSize) {
  const NUM_WORDS = { 2: "two", 3: "three", 4: "four", 5: "five", 6: "six" };
  const w = NUM_WORDS[gridSize] || "four";
  
  return [
    "You are an expert prompt engineer for AI image generation.",
    "Your task is to enhance prompts for sprite sheet generation.",
    "Keep the core subject and style, but add:",
    "- Specific art direction details",
    "- Animation choreography descriptions",
    "- Technical requirements for consistency",
    "",
    `The output should be a ${w}x${w} sprite sheet prompt optimized for Google Flow's image generation.`,
    "Make it vivid, specific, and technically precise."
  ].join("\n");
}

async function loadPreviewImage(url) {
  const image = await loadImage(url);
  state.preview.image = image;
  state.preview.objectUrl = url;
  state.preview.playIndex = 0;
  state.preview.lastTick = 0;
  drawFrame();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image loading failed"));
    image.src = src;
  });
}

function drawFrame() {
  const image = state.preview.image;
  if (!image) {
    drawPlaceholder();
    return;
  }
  
  const g = state.current.gridSize;
  const totalFrames = getTotalFrames(g);
  const frameOrder = makeFrameOrder(g);
  const frameId = frameOrder[state.preview.playIndex % frameOrder.length];
  const frameW = Math.floor(image.width / g);
  const frameH = Math.floor(image.height / g);
  
  const col = frameId % g;
  const row = Math.floor(frameId / g);
  
  previewCtx.fillStyle = "#16161e";
  previewCtx.fillRect(0, 0, elements.previewCanvas.width, elements.previewCanvas.height);
  
  const target = Math.floor(Math.min(elements.previewCanvas.width, elements.previewCanvas.height) * 0.86);
  const dx = Math.floor((elements.previewCanvas.width - target) / 2);
  const dy = Math.floor((elements.previewCanvas.height - target) / 2);
  
  previewCtx.imageSmoothingEnabled = false;
  previewCtx.drawImage(
    image,
    col * frameW,
    row * frameH,
    frameW,
    frameH,
    dx,
    dy,
    target,
    target
  );
  
  elements.frameLabel.textContent = `frame ${frameId + 1}/${totalFrames}`;
}

function drawPlaceholder() {
  previewCtx.fillStyle = "#16161e";
  previewCtx.fillRect(0, 0, elements.previewCanvas.width, elements.previewCanvas.height);
  previewCtx.fillStyle = "#4e4e58";
  previewCtx.font = "600 16px 'Space Mono', monospace";
  previewCtx.textAlign = "center";
  previewCtx.fillText("generate to preview", elements.previewCanvas.width / 2, elements.previewCanvas.height / 2);
  previewCtx.textAlign = "start";
}

function startAnimationLoop() {
  const tick = (timestamp) => {
    if (state.preview.image && state.preview.playing) {
      const fps = Number.parseInt(elements.fpsInput.value, 10) || 12;
      const interval = 1000 / Math.max(1, fps);
      
      if (timestamp - state.preview.lastTick >= interval) {
        state.preview.lastTick = timestamp;
        const totalFrames = getTotalFrames(state.current.gridSize);
        state.preview.playIndex = (state.preview.playIndex + 1) % totalFrames;
        drawFrame();
      }
    }
    
    state.preview.rafId = window.requestAnimationFrame(tick);
  };
  
  state.preview.rafId = window.requestAnimationFrame(tick);
}

function showCanvasLoader(show) {
  let overlay = document.getElementById("canvasLoader");
  if (show) {
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "canvasLoader";
      overlay.className = "canvas-loader";
      overlay.innerHTML = `
        <div class="canvas-loader-inner">
          <div class="canvas-loader-grid"></div>
          <span>generating...</span>
        </div>
      `;
      const wrap = document.querySelector(".canvas-wrap");
      if (wrap) wrap.appendChild(overlay);
    }
    overlay.classList.add("is-active");
  } else {
    if (overlay) overlay.classList.remove("is-active");
  }
}

async function onDownloadSheet() {
  if (!state.current.spriteUrl) {
    setStatus("No sheet available yet.", "error");
    return;
  }
  
  try {
    const imageData = await invoke("download_image", {
      mediaId: state.current.mediaId
    });
    
    const blob = new Blob([new Uint8Array(imageData)]);
    const url = URL.createObjectURL(blob);
    trackObjectUrl(url);
    
    const a = document.createElement("a");
    a.href = url;
    a.download = `sprite-sheet-${state.current.gridSize}x${state.current.gridSize}.png`;
    a.click();
    
    setStatus("Sheet downloaded.", "success");
  } catch (error) {
    setStatus(`Download failed: ${error.message}`, "error");
  }
}

async function onDownloadTransparent() {
  if (!state.current.transparentSpriteUrl) {
    setStatus("Transparent version not available. Enable auto background removal in Settings.", "error");
    return;
  }
  
  const a = document.createElement("a");
  a.href = state.current.transparentSpriteUrl;
  a.download = `sprite-sheet-${state.current.gridSize}x${state.current.gridSize}-transparent.png`;
  a.click();
  
  setStatus("Transparent sheet downloaded.", "success");
}

async function onDownloadGif() {
  const image = state.preview.image;
  if (!image) {
    setStatus("No animation available yet.", "error");
    return;
  }
  
  if (state.current.gifUrl) {
    triggerDownload(state.current.gifUrl, `sprite-animation-${state.current.gridSize}x${state.current.gridSize}.gif`);
    return;
  }
  
  setStatus("Building GIF...");
  
  try {
    const g = state.current.gridSize;
    const fps = Number.parseInt(elements.fpsInput.value, 10) || 12;
    const blob = await createGifBlob(image, makeFrameOrder(g), fps, 560, g);
    const objectUrl = URL.createObjectURL(blob);
    trackObjectUrl(objectUrl);
    
    state.current.gifUrl = objectUrl;
    triggerDownload(objectUrl, `sprite-animation-${g}x${g}.gif`);
    setStatus("GIF downloaded.", "success");
  } catch (error) {
    setStatus(`GIF build failed: ${error.message}`, "error");
  }
}

function createGifBlob(image, frameOrder, fps, sizePx, gridSize) {
  const g = gridSize || 4;
  return new Promise((resolve, reject) => {
    if (typeof window.GIF !== "function") {
      reject(new Error("gif.js is not loaded"));
      return;
    }
    
    const frameW = Math.floor(image.width / g);
    const frameH = Math.floor(image.height / g);
    
    const canvas = document.createElement("canvas");
    canvas.width = sizePx;
    canvas.height = sizePx;
    
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.imageSmoothingEnabled = false;
    
    const gif = new window.GIF({
      workers: 2,
      quality: 8,
      workerScript: "/gif.worker.js",
      width: sizePx,
      height: sizePx
    });
    
    const delay = Math.round(1000 / Math.max(1, fps));
    
    for (const frameId of frameOrder) {
      const col = frameId % g;
      const row = Math.floor(frameId / g);
      
      ctx.fillStyle = "#16161e";
      ctx.fillRect(0, 0, sizePx, sizePx);
      ctx.drawImage(
        image,
        col * frameW,
        row * frameH,
        frameW,
        frameH,
        24,
        24,
        sizePx - 48,
        sizePx - 48
      );
      
      gif.addFrame(ctx, { copy: true, delay });
    }
    
    gif.on("finished", (blob) => {
      resolve(blob);
    });
    
    gif.on("abort", () => {
      reject(new Error("GIF encoder aborted"));
    });
    
    gif.render();
  });
}

function triggerDownload(objectUrl, filename) {
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
}

async function appendHistoryAnimation(image, prompt) {
  try {
    const g = state.current.gridSize;
    const blob = await createGifBlob(image, makeFrameOrder(g), 10, 240, g);
    const objectUrl = URL.createObjectURL(blob);
    trackObjectUrl(objectUrl);
    insertHistoryCard(objectUrl, prompt);
  } catch {
    // Fallback to static thumbnail
  }
}

function insertHistoryCard(url, prompt) {
  const card = document.createElement("article");
  card.className = "history-card";
  
  const img = document.createElement("img");
  img.src = url;
  img.alt = "Generated animation preview";
  
  const text = document.createElement("p");
  text.textContent = prompt.split(/\s+/).slice(0, 8).join(" ");
  
  card.appendChild(img);
  card.appendChild(text);
  
  // Add to history strip if it exists
  const historyStrip = document.getElementById("historyStrip");
  if (historyStrip) {
    historyStrip.prepend(card);
    while (historyStrip.children.length > HISTORY_LIMIT) {
      historyStrip.removeChild(historyStrip.lastElementChild);
    }
  }
}

function setStatus(message, mode = "") {
  elements.statusText.textContent = message;
  elements.statusText.classList.remove("error", "success");
  if (mode) {
    elements.statusText.classList.add(mode);
  }
}

function updateWarnings(warnings) {
  if (!Array.isArray(warnings) || warnings.length === 0) {
    hideWarnings();
    return;
  }
  
  elements.warningText.classList.remove("hidden");
  elements.warningText.textContent = warnings.join(" | ");
}

function hideWarnings() {
  elements.warningText.classList.add("hidden");
  elements.warningText.textContent = "";
}

function resetGifCache() {
  state.current.gifUrl = "";
}

function trackObjectUrl(url) {
  state.objectUrls.push(url);
}

// Settings Management
function openSettings() {
  elements.settingsModal.classList.remove("hidden");
  populateSettings();
}

function closeSettingsModal() {
  elements.settingsModal.classList.add("hidden");
}

function populateSettings() {
  elements.flowApiKey.value = state.settings.flow_api_key || "";
  elements.flowProjectId.value = state.settings.flow_project_id || "";
  elements.imageModel.value = state.settings.image_model || "GEM_PIX_2";
  elements.aspectRatio.value = state.settings.image_aspect_ratio || "1:1";
  elements.rewriteEnabled.checked = state.settings.rewrite_enabled || false;
  elements.rewriteEndpoint.value = state.settings.rewrite_endpoint || "https://api.openai.com/v1";
  elements.rewriteApiKey.value = state.settings.rewrite_api_key || "";
  elements.rewriteModel.value = state.settings.rewrite_model || "gpt-4o-mini";
  elements.autoRemoveBg.checked = state.settings.auto_remove_bg || false;
  elements.rembgPath.value = state.settings.rembg_path || "rembg";
}

async function saveSettingsHandler() {
  state.settings = {
    flow_api_key: elements.flowApiKey.value.trim(),
    flow_project_id: elements.flowProjectId.value.trim(),
    image_model: elements.imageModel.value,
    image_aspect_ratio: elements.aspectRatio.value,
    rewrite_enabled: elements.rewriteEnabled.checked,
    rewrite_endpoint: elements.rewriteEndpoint.value.trim(),
    rewrite_api_key: elements.rewriteApiKey.value.trim(),
    rewrite_model: elements.rewriteModel.value,
    auto_remove_bg: elements.autoRemoveBg.checked,
    rembg_path: elements.rembgPath.value.trim(),
    safety_tolerance: 2
  };
  
  try {
    await invoke("save_settings", { settings: state.settings });
    setStatus("Settings saved.", "success");
    closeSettingsModal();
  } catch (error) {
    setStatus(`Failed to save settings: ${error.message}`, "error");
  }
}

async function loadSettings() {
  try {
    const settings = await invoke("get_settings");
    state.settings = settings;
  } catch (error) {
    console.warn("Failed to load settings:", error);
    state.settings = {};
  }
}

async function testConnectionHandler() {
  const endpoint = elements.rewriteEndpoint.value.trim();
  const apiKey = elements.rewriteApiKey.value.trim();
  
  if (!endpoint || !apiKey) {
    setStatus("Please enter both endpoint and API key.", "error");
    return;
  }
  
  setStatus("Testing connection...");
  
  try {
    const result = await invoke("test_connection", { endpoint, apiKey });
    if (result) {
      setStatus("Connection successful!", "success");
    } else {
      setStatus("Connection failed. Check your credentials.", "error");
    }
  } catch (error) {
    setStatus(`Connection test failed: ${error.message}`, "error");
  }
}

async function fetchModelsHandler() {
  const endpoint = elements.rewriteEndpoint.value.trim();
  const apiKey = elements.rewriteApiKey.value.trim();
  
  if (!endpoint || !apiKey) {
    setStatus("Please enter both endpoint and API key.", "error");
    return;
  }
  
  setStatus("Fetching models...");
  
  try {
    const models = await invoke("fetch_models", { endpoint, apiKey });
    
    const select = elements.rewriteModel;
    select.innerHTML = "";
    
    models.forEach(model => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = model.id;
      select.appendChild(option);
    });
    
    setStatus(`Loaded ${models.length} models.`, "success");
  } catch (error) {
    setStatus(`Failed to fetch models: ${error.message}`, "error");
  }
}

async function checkRembgStatus() {
  try {
    const available = await invoke("check_rembg_available");
    if (elements.rembgStatus) {
      elements.rembgStatus.textContent = available ? "Available" : "Not installed";
      elements.rembgStatus.className = `status-badge ${available ? "success" : "warning"}`;
    }
  } catch (error) {
    if (elements.rembgStatus) {
      elements.rembgStatus.textContent = "Check failed";
      elements.rembgStatus.className = "status-badge error";
    }
  }
}

async function checkBridgeStatus() {
  if (!elements.bridgeStatus) return;
  
  elements.bridgeStatus.className = "bridge-status checking";
  elements.bridgeStatus.querySelector(".bridge-text").textContent = "Bridge: Checking...";
  
  try {
    const result = await invoke("check_nano_banana_bridge");
    
    if (result.connected) {
      elements.bridgeStatus.className = "bridge-status connected";
      elements.bridgeStatus.querySelector(".bridge-text").textContent = "Bridge: Connected";
    } else {
      elements.bridgeStatus.className = "bridge-status disconnected";
      elements.bridgeStatus.querySelector(".bridge-text").textContent = "Bridge: Disconnected";
    }
  } catch (error) {
    elements.bridgeStatus.className = "bridge-status disconnected";
    elements.bridgeStatus.querySelector(".bridge-text").textContent = "Bridge: Error";
  }
}

window.addEventListener("beforeunload", () => {
  for (const url of state.objectUrls) {
    URL.revokeObjectURL(url);
  }
});
