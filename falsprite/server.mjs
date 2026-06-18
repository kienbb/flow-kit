import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateImages,
  downloadImage,
  checkExtensionStatus,
  buildSpritePrompt,
  makeDefaultPrompt,
  pickErrorMessage,
  validateHttpUrl
} from "./lib/nano-banana.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const MIME_BY_EXT = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".ico": "image/x-icon"
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(text);
}

async function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    req.on("data", (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) { reject(new Error("Payload too large")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) { resolve({}); return; }
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf-8"))); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

// ── Handlers ────────────────────────────────────

async function handleStatus(req, res) {
  const result = await checkExtensionStatus();
  if (result.ok) {
    sendJson(res, 200, { ok: true, status: result.data });
  } else {
    sendJson(res, 503, { ok: false, error: result.error });
  }
}

async function handleGenerate(req, res) {
  let body;
  try { body = await parseJsonBody(req); } catch (e) { sendJson(res, 400, { error: e.message }); return; }

  const extensionId = body.extensionId || "";
  if (!extensionId) { 
    sendJson(res, 400, { error: "Missing Extension ID. Please configure your Nano Banana Bridge Extension ID." }); 
    return; 
  }

  const originalPrompt = (typeof body.prompt === "string" && body.prompt.trim()) ? body.prompt.trim() : makeDefaultPrompt();
  const gridSize = Math.max(2, Math.min(6, parseInt(body.gridSize, 10) || 4));
  const warnings = [];

  // Build sprite prompt
  const spritePrompt = buildSpritePrompt(originalPrompt, gridSize);

  // Generate sprite sheet using Nano Banana
  const generateResult = await generateImages({
    prompt: spritePrompt,
    aspectRatio: "1:1",
    count: 1,
    model: "nano-banana-pro"
  });

  if (!generateResult.ok) {
    sendJson(res, 502, { 
      error: pickErrorMessage(generateResult.data, "Sprite generation failed"), 
      warnings 
    });
    return;
  }

  const spriteUrl = generateResult.data?.images?.[0] || "";
  if (!spriteUrl) {
    sendJson(res, 502, { error: "No image URL in generation result", warnings });
    return;
  }

  // Note: Background removal is not available in Nano Banana API
  // The generated image will have the background as generated
  const transparentSpriteUrl = ""; // Not supported

  sendJson(res, 200, {
    promptOriginal: originalPrompt,
    promptRewritten: originalPrompt,
    spriteUrl,
    transparentSpriteUrl,
    warnings: [...warnings, "Background removal not available with Nano Banana API. Download the sheet and use external tools if needed."],
    metadata: { grid: `${gridSize}x${gridSize}`, gridSize, resolution: "2K" }
  });
}

async function handleDownload(req, res) {
  let body;
  try { body = await parseJsonBody(req); } catch (e) { sendJson(res, 400, { error: e.message }); return; }

  const { mediaId } = body;
  if (!mediaId) { sendJson(res, 400, { error: "Missing mediaId" }); return; }

  const result = await downloadImage(mediaId);
  if (!result.ok) {
    sendJson(res, 502, { error: result.error });
    return;
  }

  const buffer = Buffer.from(await result.data.blob.arrayBuffer());
  res.writeHead(200, {
    "Content-Type": result.data.mimeType || "image/png",
    "Cache-Control": "no-store",
    "Content-Length": buffer.length
  });
  res.end(buffer);
}

async function serveStatic(req, res, urlObject) {
  const requestPath = urlObject.pathname === "/" ? "/index.html" : urlObject.pathname;
  const normalized = path.normalize(requestPath).replace(/^\/+/, "");
  const filePath = path.join(PUBLIC_DIR, normalized);
  if (!filePath.startsWith(PUBLIC_DIR)) { sendText(res, 403, "Forbidden"); return; }

  try {
    const file = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_BY_EXT[ext] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(file);
  } catch {
    sendText(res, 404, "Not found");
  }
}

// ── Server ──────────────────────────────────────

const server = createServer(async (req, res) => {
  const urlObject = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method === "GET" && urlObject.pathname === "/health") { sendJson(res, 200, { ok: true }); return; }
  if (req.method === "GET" && urlObject.pathname === "/api/status") { await handleStatus(req, res); return; }
  if (req.method === "POST" && urlObject.pathname === "/api/generate") { await handleGenerate(req, res); return; }
  if (req.method === "POST" && urlObject.pathname === "/api/download") { await handleDownload(req, res); return; }

  if (req.method === "POST" && urlObject.pathname === "/api/showcase") {
    try {
      const body = await parseJsonBody(req);
      if (!Array.isArray(body)) { sendJson(res, 400, { error: "Body must be a JSON array" }); return; }
      await writeFile(path.join(PUBLIC_DIR, "showcase.json"), JSON.stringify(body, null, 2) + "\n");
      sendJson(res, 200, { ok: true, count: body.length });
    } catch (e) { sendJson(res, 400, { error: e.message }); }
    return;
  }

  await serveStatic(req, res, urlObject);
});

server.listen(PORT, () => {
  console.log(`FalSprite (Nano Banana Edition) running on http://localhost:${PORT}`);
});
