# FalSprite - Nano Banana Edition

Sprite sheet generator powered by **Nano Banana Bridge** (Google Flow API Gateway) instead of fal.ai.

## 🎯 What Changed

- **Removed**: fal.ai API dependency, BRIA background removal, OpenRouter LLM rewrite
- **Added**: Nano Banana Bridge Chrome Extension integration
- **Cost**: FREE (uses your Google Flow quota)

## 🚀 Prerequisites

1. **Chrome Browser** with Nano Banana Bridge Extension installed
2. **Google Account** logged into Google Flow (labs.google/fx)

## 📦 Installation

### 1. Install Nano Banana Bridge Extension

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `nano-banana-bridge/` folder
5. Copy the **Extension ID** from the extension card

### 2. Start FalSprite Server

```bash
npm install
npm run dev
```

Server runs on `http://localhost:8787`

### 3. Configure Extension ID

1. Open `http://localhost:8787`
2. Paste your Nano Banana Bridge **Extension ID** in the top bar
3. The ID is saved to localStorage for convenience

## 🎮 Usage

1. **Enter a prompt** describing your character
2. **Select grid size** (2x2 to 6x6)
3. **Choose actions** (optional) - idle, walk, run, attack, etc.
4. **Click GENERATE**
5. **Preview animation** in real-time
6. **Download** as sheet or GIF

## 🔧 API Endpoints

### GET /health
Health check endpoint.

### GET /api/status
Check Nano Banana Bridge extension status.

### POST /api/generate
Generate sprite sheet.

**Request:**
```json
{
  "extensionId": "your-extension-id",
  "prompt": "baby dragon, clean pixel art, isometric action RPG",
  "gridSize": 4
}
```

**Response:**
```json
{
  "promptOriginal": "baby dragon...",
  "promptRewritten": "...",
  "spriteUrl": "https://...",
  "transparentSpriteUrl": "",
  "warnings": [],
  "metadata": {
    "grid": "4x4",
    "gridSize": 4,
    "resolution": "2K"
  }
}
```

### POST /api/download
Download image by media ID.

**Request:**
```json
{
  "mediaId": "abc123"
}
```

## 📝 Notes

- **Background removal** is not available with Nano Banana API. Use external tools like Photoshop, GIMP, or online removers if needed.
- **LLM rewrite** is disabled. Prompts are used directly with sprite sheet formatting.
- **Reference images** can be uploaded but are not used for image-to-image generation (not supported by Nano Banana API).

## 🐛 Troubleshooting

### "Missing Extension ID"
- Install Nano Banana Bridge extension
- Copy Extension ID from `chrome://extensions/`
- Paste into the input field

### "Extension error"
- Make sure the extension is enabled
- Check that you're logged into Google Flow
- Try reloading the extension

### "Generation failed"
- Check Google Flow is accessible
- Verify you have quota available
- Try a simpler prompt

## 📄 License

MIT
