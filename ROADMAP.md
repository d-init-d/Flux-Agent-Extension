# 🚀 Flux Agent Extension - Development Roadmap

> AI-powered browser agent that integrates into Chrome sidebar with full web control capabilities

## 📋 Project Overview

**Name:** Flux Agent Extension  
**Type:** Chrome Extension (Manifest V3)  
**Goal:** Tích hợp AI vào sidebar Chrome, cho phép AI điều khiển web như một agent thông minh  
**Inspiration:** Comet Browser (Perplexity)

---

## 🎯 Vision

Tạo một extension cho phép người dùng:
- Chat với AI trực tiếp trong sidebar
- AI có thể **nhìn thấy** và **tương tác** với trang web đang mở
- Thực hiện các tác vụ tự động: click, điền form, scrape data, navigate...
- Hỗ trợ nhiều AI providers (Claude, GPT-4, Gemini, Ollama, Google Account)

---

## 📅 Development Phases

### Phase 1: Foundation (Week 1-2)
> Setup project structure và core infrastructure

| Task | Priority | Status | Description |
|------|----------|--------|-------------|
| Project Setup | 🔴 High | ⬜ Todo | Vite + React + TypeScript + Tailwind |
| Manifest V3 | 🔴 High | ⬜ Todo | Permissions, service worker, content scripts |
| Message Hub | 🔴 High | ⬜ Todo | Communication giữa sidebar ↔ background ↔ content |
| Basic Sidebar UI | 🟡 Medium | ⬜ Todo | Chat interface cơ bản |

**Deliverables:**
- [ ] Extension có thể load vào Chrome
- [ ] Sidebar mở được và hiển thị UI
- [ ] Message passing hoạt động

---

### Phase 2: DOM Controller (Week 2-3)
> Content script với khả năng điều khiển web

| Task | Priority | Status | Description |
|------|----------|--------|-------------|
| DOM Query System | 🔴 High | ⬜ Todo | Tìm elements bằng selector, text, role |
| Click Action | 🔴 High | ⬜ Todo | Click vào elements |
| Type Action | 🔴 High | ⬜ Todo | Điền text vào inputs |
| Scroll Action | 🟡 Medium | ⬜ Todo | Scroll trang, scroll to element |
| Hover Action | 🟢 Low | ⬜ Todo | Hover để trigger tooltips, menus |
| Element Highlighter | 🟡 Medium | ⬜ Todo | Visual feedback khi AI đang tương tác |

**Deliverables:**
- [ ] AI có thể click vào bất kỳ element nào
- [ ] AI có thể điền form
- [ ] Visual highlighting khi AI thao tác

---

### Phase 3: Vision & Screenshot (Week 3-4)
> Cho AI khả năng "nhìn" trang web

| Task | Priority | Status | Description |
|------|----------|--------|-------------|
| Full Page Screenshot | 🔴 High | ⬜ Todo | Capture toàn bộ viewport |
| Element Screenshot | 🟡 Medium | ⬜ Todo | Screenshot 1 element cụ thể |
| DOM to Text | 🔴 High | ⬜ Todo | Convert DOM thành text mô tả cho AI |
| Accessibility Tree | 🟡 Medium | ⬜ Todo | Extract accessibility info |
| Page Context | 🔴 High | ⬜ Todo | URL, title, meta, structured data |

**Deliverables:**
- [ ] AI nhận được screenshot của trang
- [ ] AI có context về nội dung trang

---

### Phase 4: AI Providers (Week 4-5)
> Multi-provider AI integration

| Task | Priority | Status | Description |
|------|----------|--------|-------------|
| Provider Interface | 🔴 High | ⬜ Todo | Abstract base class cho providers |
| Claude API | 🔴 High | ⬜ Todo | Anthropic Claude integration |
| OpenAI GPT-4 | 🔴 High | ⬜ Todo | OpenAI integration |
| Google Gemini | 🟡 Medium | ⬜ Todo | Gemini API integration |
| Ollama Local | 🟡 Medium | ⬜ Todo | Local LLM support |
| Google Account Auth | 🔴 High | ⬜ Todo | OAuth flow cho Google AI (custom implementation) |
| Provider Switcher | 🟡 Medium | ⬜ Todo | UI để chọn/switch provider |

**Deliverables:**
- [ ] Có thể chat với ít nhất 2 providers
- [ ] Google Account authentication hoạt động
- [ ] Settings UI để configure API keys

---

### Phase 5: Agent System (Week 5-7)
> Tool-use và planning system

| Task | Priority | Status | Description |
|------|----------|--------|-------------|
| Tool Definitions | 🔴 High | ⬜ Todo | Define tools cho AI (click, type, scroll...) |
| Action Planner | 🔴 High | ⬜ Todo | AI lên kế hoạch multi-step actions |
| Action Executor | 🔴 High | ⬜ Todo | Execute planned actions |
| Error Recovery | 🟡 Medium | ⬜ Todo | Handle failures, retry logic |
| Action History | 🟡 Medium | ⬜ Todo | Log các actions đã thực hiện |
| Undo System | 🟢 Low | ⬜ Todo | Rollback actions (if possible) |

**Deliverables:**
- [ ] AI có thể thực hiện multi-step tasks
- [ ] User thấy được kế hoạch trước khi AI thực thi
- [ ] Error handling robust

---

### Phase 6: Data Extraction (Week 7-8)
> Scraping và structured data extraction

| Task | Priority | Status | Description |
|------|----------|--------|-------------|
| Text Extraction | 🔴 High | ⬜ Todo | Extract text từ elements |
| Table Extraction | 🔴 High | ⬜ Todo | Parse tables thành JSON/CSV |
| Link Extraction | 🟡 Medium | ⬜ Todo | Extract all links |
| Image Extraction | 🟡 Medium | ⬜ Todo | Extract image URLs |
| Structured Output | 🟡 Medium | ⬜ Todo | AI output theo schema định sẵn |
| Export Functions | 🟢 Low | ⬜ Todo | Export to JSON, CSV, clipboard |

**Deliverables:**
- [ ] Scrape data từ bất kỳ trang nào
- [ ] Export data ra các format phổ biến

---

### Phase 7: Advanced Features (Week 8-10)
> Polish và advanced capabilities

| Task | Priority | Status | Description |
|------|----------|--------|-------------|
| Conversation Memory | 🟡 Medium | ⬜ Todo | Lưu lịch sử chat |
| Task Templates | 🟡 Medium | ⬜ Todo | Preset tasks (fill form, scrape...) |
| Keyboard Shortcuts | 🟢 Low | ⬜ Todo | Quick actions |
| Dark/Light Theme | 🟢 Low | ⬜ Todo | Theme switcher |
| Multi-tab Support | 🟡 Medium | ⬜ Todo | Control nhiều tabs |
| Automation Recipes | 🟢 Low | ⬜ Todo | Save & replay action sequences |

---

### Phase 8: Security & Production (Week 10-12)
> Hardening và release preparation

| Task | Priority | Status | Description |
|------|----------|--------|-------------|
| Permission Audit | 🔴 High | ⬜ Todo | Minimize required permissions |
| API Key Security | 🔴 High | ⬜ Todo | Secure storage cho keys |
| Rate Limiting | 🟡 Medium | ⬜ Todo | Prevent API abuse |
| Error Reporting | 🟡 Medium | ⬜ Todo | Sentry/logging integration |
| Performance Optimization | 🟡 Medium | ⬜ Todo | Bundle size, memory usage |
| Chrome Web Store | 🟢 Low | ⬜ Todo | Prepare for publishing |

---

## 🛠️ Tech Stack

| Category | Technology | Reason |
|----------|------------|--------|
| Build Tool | Vite | Fast HMR, excellent DX |
| UI Framework | React 18 | Component-based, large ecosystem |
| Styling | Tailwind CSS | Rapid UI development |
| Language | TypeScript | Type safety, better DX |
| State | Zustand | Lightweight, simple API |
| Icons | Lucide React | Consistent icon set |
| AI SDK | Vercel AI SDK | Unified interface for providers |

---

## 📊 Success Metrics

| Metric | Target | Current |
|--------|--------|---------|
| Extension Load Time | < 500ms | - |
| Screenshot Capture | < 1s | - |
| AI Response Time | < 3s | - |
| Action Execution | < 500ms | - |
| Bundle Size | < 500KB | - |

---

## 🔗 References

- [Chrome Extension Manifest V3](https://developer.chrome.com/docs/extensions/mv3/)
- [Anthropic Claude API](https://docs.anthropic.com/)
- [OpenAI API](https://platform.openai.com/docs)
- [Comet Browser (Perplexity)](https://www.perplexity.ai/) - Inspiration
- [Browser Use](https://github.com/browser-use/browser-use) - Agent framework reference

---

## 📝 Notes

- **Privacy:** Tất cả data xử lý locally, chỉ gửi lên AI provider khi user yêu cầu
- **Security:** API keys được mã hóa, không gửi qua network không cần thiết
- **Performance:** Lazy load các modules, optimize cho low memory usage

---

*Last Updated: 2025-02-03*
