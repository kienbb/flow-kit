# Nano Banana Bridge - Flow Image Generation API

Chrome Extension điều khiển **Google Flow** tạo ảnh qua **API trực tiếp**, tập trung vào **Nano Banana Pro** (GEM_PIX_2). Không tự động thao tác giao diện web.

## 🎯 Tính năng

- ✅ **Direct API** - Gọi thẳng `batchGenerateImages` của Google Flow, không gõ prompt / click nút trên trang
- ✅ **Messaging interface** - Điều khiển qua `chrome.runtime.sendMessage` từ web page hoặc extension khác
- ✅ **Nano Banana Pro** (GEM_PIX_2) - Model chất lượng cao nhất
- ✅ **Batch Generation** - Tạo nhiều ảnh cùng lúc
- ✅ **Download** - Tải ảnh dạng base64 hoặc URL
- ✅ **Queue Management** - Quản lý hàng đợi requests

> ⚠️ **Lưu ý kiến trúc**: Đây KHÔNG phải HTTP server. Service worker MV3 không mở được cổng lắng nghe. Interface là `chrome.runtime.sendMessage` / `onMessageExternal`. Một tab Google Flow đã đăng nhập phải mở sẵn — extension chạy reCAPTCHA + fetch có xác thực ngay trong tab đó (không thao tác UI).

## 📁 Cấu trúc

```
nano-banana-bridge/
├── manifest.json              # Manifest V3
├── background.js              # Service Worker + API Router
├── api.html                   # API Documentation Page
├── flow-config.json           # Cấu hình API
├── content/
│   ├── content_main.js        # MAIN world - Token extraction
│   └── content_isolated.js    # ISOLATED world - Message bridge
├── modules/
│   ├── session.js             # Quản lý session
│   ├── image-gen.js           # Tạo ảnh
│   └── api-server.js          # API Server
├── popup/
│   ├── popup.html             # UI popup
│   └── popup.js               # Logic popup
└── icons/
```

## 🚀 Cài đặt

### Bước 1: Load Extension

1. Mở Chrome → `chrome://extensions/`
2. Bật **Developer mode**
3. Click **Load unpacked**
4. Chọn thư mục `nano-banana-bridge/`

### Bước 2: Lấy Extension ID

- Click icon **Nano Banana Bridge** trên toolbar
- Copy **Extension ID** hiển thị trong popup

### Bước 3: Mở Google Flow

- Mở `labs.google/fx/tools/flow`
- **Đăng nhập Google**
- Extension tự động lấy Bearer Token

## 📡 API Usage

### Cách 1: Chrome Runtime Messaging (Khuyến nghị)

```javascript
const EXTENSION_ID = 'your-extension-id-here';

// Generate image
chrome.runtime.sendMessage(EXTENSION_ID, {
  action: 'generate',
  prompt: 'a beautiful sunset over mountains',
  aspectRatio: '16:9',
  count: 4,
  model: 'nano-banana-pro'
}, response => {
  console.log(response);
  // {
  //   success: true,
  //   data: {
  //     mediaIds: ['abc123', 'def456'],
  //     prompt: 'a beautiful sunset over mountains',
  //     aspectRatio: '16:9',
  //     count: 4,
  //     model: 'GEM_PIX_2'
  //   }
  // }
});
```

### Cách 2: Từ Web Page (với externally_connectable)

```javascript
// Trang web phải nằm trong matches của externally_connectable
const EXTENSION_ID = 'your-extension-id-here';

chrome.runtime.sendMessage(EXTENSION_ID, {
  action: 'generate',
  prompt: 'a cute cat',
  aspectRatio: '1:1',
  count: 4
}, response => {
  console.log(response);
});
```

### Cách 3: Từ Extension khác

```javascript
chrome.runtime.sendMessage('your-extension-id', {
  action: 'generate',
  prompt: 'hello world'
}, response => {
  console.log(response);
});
```

## 📚 API Endpoints

### Generate Image

```javascript
{
  action: 'generate',
  prompt: string,           // required
  aspectRatio: '1:1' | '16:9' | '9:16',  // default: '1:1'
  count: number,            // 1-4, default: 4
  model: 'nano-banana-pro' | 'nano-banana-2' | 'nano-banana',  // default: 'nano-banana-pro'
  seed: number,             // optional
  projectId: string         // optional (uses current if not set)
}
```

### Generate Batch

```javascript
{
  action: 'generate-batch',
  prompts: string[],        // required
  aspectRatio: string,      // default: '1:1'
  count: number,            // default: 4
  model: string             // default: 'nano-banana-pro'
}
```

### Get Status

```javascript
{
  action: 'status'
}
```

Response:
```javascript
{
  success: true,
  data: {
    authenticated: true,
    projectId: 'abc123',
    projectSet: true,
    version: '1.0.0'
  }
}
```

### Get Models

```javascript
{
  action: 'models'
}
```

### Get Aspect Ratios

```javascript
{
  action: 'aspect-ratios'
}
```

### Download Image

```javascript
{
  action: 'download',
  mediaId: string,          // required
  format: 'base64' | 'url'  // default: 'base64'
}
```

### Set Project

```javascript
{
  action: 'set-project',
  projectId: string         // required
}
```

### Clear Session

```javascript
{
  action: 'clear-session'
}
```

## 🎨 Models

| ID | Name | API ID | Mô tả |
|-----|-----|--------|-------|
| nano-banana-pro | Nano Banana Pro | GEM_PIX_2 | Highest quality |
| nano-banana-2 | Nano Banana 2 | NARWHAL | Balanced |
| nano-banana | Nano Banana | GEM_PIX_0 | Fast |

## 📐 Aspect Ratios

| ID | Name | Constant |
|-----|------|----------|
| 1:1 | Square | IMAGE_ASPECT_RATIO_SQUARE |
| 16:9 | Landscape | IMAGE_ASPECT_RATIO_LANDSCAPE |
| 9:16 | Portrait | IMAGE_ASPECT_RATIO_PORTRAIT |

## 🔐 Authentication

Extension tự động lấy Bearer Token khi bạn đăng nhập Google Flow. Không cần cấu hình thêm.

## 📝 Ví dụ đầy đủ

```javascript
const EXTENSION_ID = 'your-extension-id';

// 1. Kiểm tra status
chrome.runtime.sendMessage(EXTENSION_ID, { action: 'status' }, response => {
  if (!response.data.authenticated) {
    console.log('Please login to Google Flow first');
    return;
  }
  
  // 2. Tạo ảnh
  chrome.runtime.sendMessage(EXTENSION_ID, {
    action: 'generate',
    prompt: 'a futuristic city at night with neon lights',
    aspectRatio: '16:9',
    count: 4,
    model: 'nano-banana-pro'
  }, result => {
    if (result.success) {
      console.log('Generated media IDs:', result.data.mediaIds);
      
      // 3. Download ảnh đầu tiên
      chrome.runtime.sendMessage(EXTENSION_ID, {
        action: 'download',
        mediaId: result.data.mediaIds[0]
      }, download => {
        if (download.success) {
          console.log('Image base64:', download.data.base64.substring(0, 50) + '...');
        }
      });
    }
  });
});
```

## 🐛 Troubleshooting

### "Not authenticated"
- Đảm bảo đã đăng nhập Google trên Flow
- Refresh trang Flow

### "No project ID"
- Mở một project trên Flow
- Hoặc gọi `set-project` với project ID

### Extension ID không tìm thấy
- Mở `chrome://extensions/`
- Tìm "Nano Banana Bridge"
- Copy ID từ đó

## 📄 License

MIT
