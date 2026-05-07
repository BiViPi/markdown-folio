# Markdown Folio

[English](https://github.com/BiViPi/markdown-folio/blob/main/README.md) | Tiếng Việt

> Biến các file Markdown thô thành tài liệu chỉn chu, sẵn sàng in ấn ngay trong VS Code.

---

## Preview

**Ivory Theme**
![Ivory](https://raw.githubusercontent.com/BiViPi/markdown-folio/main/images/ivory.png)

**Admiral Theme**
![Admiral](https://raw.githubusercontent.com/BiViPi/markdown-folio/main/images/admiral.png)

**Serene Theme**
![Serene](https://raw.githubusercontent.com/BiViPi/markdown-folio/main/images/serene.png)

**Cyberpunk Theme**
![Cyberpunk](https://raw.githubusercontent.com/BiViPi/markdown-folio/main/images/cyberpunk.png)

**Dracula Theme**
![Dracula](https://raw.githubusercontent.com/BiViPi/markdown-folio/main/images/dracula.png)

---

## Features

### Export
- **Xuất đa định dạng** — PDF (A4/A3/Letter, dọc/ngang), Word (DOCX), HTML và PNG chỉ với một lần bấm

### Rendering
- **Công thức toán học** — Hỗ trợ đầy đủ KaTeX cho công thức inline `$...$` và display `$$...$$`, đồng thời render native vào Word
- **Mermaid Diagrams** — Flowchart, sequence, Gantt, mindmap, gitGraph và nhiều loại sơ đồ khác

### Appearance
- **6 theme chuyên nghiệp** — Ivory, Admiral, Serene, Cyberpunk, Dracula và GitHub
- **Typography** — Tùy chỉnh font heading/body, cỡ chữ, heading scale, line spacing và page width
- **Table of Contents** — Sidebar mục lục tự động sinh, bấm để điều hướng

### Workflow
- **Bi-directional Scroll Sync** — Cuộn editor thì preview đi theo; cuộn preview thì editor tự reveal đúng vị trí tương ứng
- **Smart Copy** — Sao chép nội dung theo ba chế độ: **Rich HTML** (cho Gmail/Word/Notion), **Notion Markdown** (source sạch, bỏ frontmatter), hoặc **Plain Text**
- **Paste Image from Clipboard** — Nhấn `Ctrl+Alt+V` để lưu nhanh ảnh chụp vào thư mục `assets/` và chèn link Markdown ngay tại con trỏ

---

## Quick Start

1. Mở bất kỳ file `.md` nào
2. Bấm icon **Markdown Folio** trên thanh tiêu đề của editor
3. Dùng floating toolbar để export, copy nội dung hoặc chỉnh settings

> Export PDF và PNG yêu cầu máy đã cài **Chrome** hoặc **Chromium**.

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `markdownFolio.theme` | `ivory` | Theme preview (ivory, admiral, serene, cyberpunk, dracula, github) |
| `markdownFolio.headingFont` | Merriweather | Font family cho heading |
| `markdownFolio.bodyFont` | DM Sans | Font family cho body text |
| `markdownFolio.fontSize` | `16` | Cỡ chữ theo pixel |
| `markdownFolio.headingSize` | `M` | Tỷ lệ heading: S / M / L |
| `markdownFolio.lineSpacing` | `normal` | Giãn dòng: compact / normal / relaxed |
| `markdownFolio.pageWidth` | `standard` | Bề rộng trang: narrow / standard / wide |
| `markdownFolio.scrollSync` | `true` | Bật bi-directional scroll sync |
| `markdownFolio.pasteImage.folder` | `assets` | Thư mục lưu ảnh dán vào (tương đối theo file markdown) |
| `markdownFolio.showToolbar` | `true` | Hiện/ẩn floating toolbar |
| `markdownFolio.showTocSidebar` | `true` | Hiện/ẩn sidebar mục lục |

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+V` | Dán ảnh từ clipboard vào markdown |

---

## Feedback

Phát hiện lỗi hoặc có đề xuất? [Mở issue trên GitHub](https://github.com/BiViPi/markdown-folio/issues).
