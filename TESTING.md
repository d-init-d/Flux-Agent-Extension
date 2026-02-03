# ✅ Phase 1 Complete - Testing Guide

## Đã hoàn thành

- ✅ Vite + React + TypeScript setup
- ✅ Manifest V3 với permissions đầy đủ
- ✅ Background service worker với message hub
- ✅ Content script injection vào mọi trang
- ✅ Sidebar React app với chat UI
- ✅ Zustand state management
- ✅ Message passing system hoạt động

---

## 🚀 Cách test

### 1. Cài đặt dependencies

```bash
pnpm install
```

### 2. Build extension

```bash
pnpm dev
```

Lệnh này sẽ:
- Build extension vào folder `dist/`
- Bật watch mode (auto-reload khi code thay đổi)

### 3. Load extension vào Chrome

1. Mở Chrome
2. Vào `chrome://extensions/`
3. Bật **Developer mode** (góc trên phải)
4. Click **Load unpacked**
5. Chọn thư mục `dist` trong project

### 4. Test các tính năng

#### Test 1: Extension Icon
- Click vào icon extension trên toolbar
- Sidebar sẽ mở ở bên phải màn hình
- ✅ **Expected:** Sidebar hiển thị với UI chat

#### Test 2: Chat Interface
- Thử gõ một message: "Hello"
- Click nút Send hoặc nhấn Enter
- ✅ **Expected:** 
  - Message của bạn hiển thị bên phải (màu tím)
  - Loading indicator xuất hiện
  - Bot trả lời echo message của bạn

#### Test 3: Content Script
- Mở DevTools (F12)
- Vào tab Console
- ✅ **Expected:** Thấy log `[Flux Agent] Content script loaded`

#### Test 4: Background Service Worker
- Vào `chrome://extensions/`
- Tìm "Flux Agent" extension
- Click "service worker" (link màu xanh)
- ✅ **Expected:** DevTools mở với log `[Flux Agent] Background service worker ready`

---

## 🐛 Troubleshooting

### Extension không load được

**Lỗi:** "Manifest file is missing or unreadable"
- ✅ **Fix:** Chạy `pnpm dev` để build lại

### Sidebar không mở

**Lỗi:** Click icon không có gì xảy ra
- ✅ **Fix:** 
  1. Reload extension (click icon reload trong chrome://extensions/)
  2. Refresh trang web
  3. Click icon lại

### Message không gửi được

**Lỗi:** Click Send nhưng không thấy response
- ✅ **Fix:**
  1. Mở DevTools của sidebar (right-click sidebar → Inspect)
  2. Check Console có error gì không
  3. Verify background service worker đang chạy

### Build error

**Lỗi:** `pnpm dev` báo lỗi
- ✅ **Fix:**
  ```bash
  # Xóa node_modules và reinstall
  rm -rf node_modules pnpm-lock.yaml
  pnpm install
  pnpm dev
  ```

---

## 📸 Screenshots Expected

### Sidebar UI
```
┌─────────────────────────┐
│ 🤖 Flux Agent           │
│ AI Browser Assistant    │
├─────────────────────────┤
│                         │
│  Welcome to Flux Agent  │
│  I can help you...      │
│                         │
├─────────────────────────┤
│ [Type message...] [➤]  │
└─────────────────────────┘
```

### After sending message
```
┌─────────────────────────┐
│ 🤖 Flux Agent           │
├─────────────────────────┤
│                         │
│ 🤖 Hello! I can help... │
│                         │
│         👤 Hello        │
│                         │
│ 🤖 Echo: "Hello"        │
│                         │
├─────────────────────────┤
│ [Type message...] [➤]  │
└─────────────────────────┘
```

---

## ✨ Next Steps

Phase 1 hoàn thành! Tiếp theo:

- **Phase 2:** DOM Controller - Click, type, scroll actions
- **Phase 4:** AI Providers - Integrate Claude/GPT-4

Xem [ROADMAP.md](./ROADMAP.md) để biết chi tiết.

---

## 📝 Notes

- Extension hiện tại chỉ echo lại message (chưa có AI thật)
- DOM actions sẽ được implement ở Phase 2
- Icons placeholder - cần generate PNG thật cho production

---

**Status:** ✅ Phase 1 Complete  
**Date:** 2025-02-03  
**Repo:** https://github.com/d-init-d/Flux-Agent-Extension
