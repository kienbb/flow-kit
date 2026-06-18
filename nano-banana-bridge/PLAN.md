# Nano Banana Bridge - Implementation Plan

## ✅ Trạng thái

Extension điều khiển Google Flow tạo ảnh qua **API trực tiếp**, không thao tác UI.
Vị trí: `D:\Projects\google-flow-proxy\nano-banana-bridge\`

## 📁 Cấu trúc file

```
nano-banana-bridge/
├── manifest.json              # Manifest V3
├── background.js              # Service Worker + token capture + message router
├── flow-config.json           # Cấu hình API (endpoint, model id, aspect ratio)
├── api.html                   # Trang tài liệu API
├── content/
│   ├── content_main.js        # MAIN world - báo projectId + prime token
│   └── content_isolated.js    # ISOLATED world - cầu nối message
├── modules/
│   ├── session.js             # Quản lý session (token, projectId, Flow tab)
│   ├── image-gen.js           # Tạo ảnh + tải ảnh (direct API)
│   └── api-server.js          # Định tuyến request (messaging, KHÔNG phải HTTP server)
├── popup/
│   ├── popup.html
│   └── popup.js
└── icons/
```

## 🏗️ Kiến trúc

> Service worker MV3 **không** mở được cổng HTTP. Interface là `chrome.runtime`
> messaging. Google Flow bắt buộc reCAPTCHA Enterprise (chỉ sinh được trong
> trang `labs.google`) + cookie first-party, nên request tạo ảnh được chạy
> **bên trong tab Flow** qua `chrome.scripting.executeScript` (MAIN world).
> Tab Flow chỉ cần mở + đăng nhập; extension không gõ prompt / click nút.

### Luồng tạo ảnh

1. `background.js` nhận message `generate` (hoặc external `action:'generate'`).
2. `api-server.js` validate → gọi `image-gen.js:generateImage()`.
3. `image-gen.js`:
   - đảm bảo có tab Flow (`ensureFlowTab`),
   - mint reCAPTCHA token trong tab (`grecaptcha.enterprise.execute`),
   - POST `flowMedia:batchGenerateImages` **trong MAIN world** với
     `authorization` + `credentials:'include'`,
   - parse `media[].image.generatedImage.fifeUrl | .uri | imageBytes`.
4. `batchGenerateImages` là **đồng bộ** - response đã chứa media (không polling;
   chỉ video mới async).

### Token capture

`background.js` lắng nghe `webRequest.onBeforeSendHeaders` trên `labs.google` +
`aisandbox-pa.googleapis.com`, bắt header `Authorization: Bearer ...` và lưu vào
session. `content_main.js` bắn vài request mồi để listener có cái bắt sớm.

## 🔧 Endpoint Google sử dụng

```
POST https://aisandbox-pa.googleapis.com/v1/projects/{projectId}/flowMedia:batchGenerateImages
GET  https://aisandbox-pa.googleapis.com/v1/media/{mediaId}
```

## 📋 Payload batchGenerateImages

```json
{
  "clientContext": {
    "recaptchaContext": { "token": "...", "applicationType": "RECAPTCHA_APPLICATION_TYPE_WEB" },
    "projectId": "{projectId}",
    "tool": "PINHOLE",
    "sessionId": ";{timestamp}"
  },
  "mediaGenerationContext": { "batchId": "{uuid}" },
  "useNewMedia": true,
  "requests": [{
    "clientContext": { "...": "same as above" },
    "imageModelName": "GEM_PIX_2",
    "imageAspectRatio": "IMAGE_ASPECT_RATIO_SQUARE",
    "structuredPrompt": { "parts": [{ "text": "..." }] },
    "seed": 123456,
    "imageInputs": []
  }]
}
```

## 🎨 Model hỗ trợ

| Tên | ID | Mô tả |
|-----|-----|-------|
| Nano Banana Pro | GEM_PIX_2 | Highest quality |
| Nano Banana 2 | NARWHAL | Balanced |
| Nano Banana | GEM_PIX_0 | Fast |

## 🔐 Permissions

- `tabs`, `scripting` - tìm + chạy code trong tab Flow
- `storage` - lưu session
- `webRequest` - bắt Bearer token
- `clipboardWrite`
- Host: `labs.google`, `aisandbox-pa.googleapis.com`, `googleusercontent.com`

## 📝 Ghi chú

- Chỉ hỗ trợ Google Flow (không ChatGPT/Grok).
- Không hỗ trợ style preset / negative prompt (API Flow không nhận).
- ES6 Modules + Manifest V3.
