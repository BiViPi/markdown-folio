# Markdown Folio

English | [Tiếng Việt](https://github.com/BiViPi/markdown-folio/blob/main/README-VN.md)

> Transform your raw Markdown files into polished, print-ready documents — right inside VS Code.

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

### 📄 Export
- **Multi-Format Export** — PDF (A4/A3/Letter, portrait/landscape), Word (DOCX), HTML, and PNG in one click

### 🔢 Rendering
- **Math Formulas** — Full KaTeX support for inline `$...$` and display `$$...$$` equations, rendered natively in Word
- **Mermaid Diagrams** — Flowchart, sequence, Gantt, mindmap, gitGraph, and more

### 🎨 Appearance
- **6 Professional Themes** — Ivory, Admiral, Serene, Cyberpunk, Dracula, and GitHub
- **Typography** — Configurable heading/body fonts, font size, heading scale, line spacing, and page width
- **Table of Contents** — Auto-generated sidebar, click to navigate

### ⚡ Workflow
- **Bi-directional Scroll Sync** — Scroll the editor and the preview follows; scroll the preview and the editor reveals the corresponding position automatically
- **Smart Copy** — Copy content in three modes: **Rich HTML** (for Gmail/Word/Notion), **Notion Markdown** (clean source, no frontmatter), or **Plain Text**
- **Paste Image from Clipboard** — Press `Ctrl+Alt+V` to instantly save a screenshot to an `assets/` folder and insert a Markdown image link at cursor

---

## Quick Start

1. Open any `.md` file
2. Click the **Markdown Folio** icon in the editor title bar
3. Use the floating toolbar to export, copy content, or adjust settings

> PDF and PNG export require **Chrome or Chromium** to be installed on your machine.

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `markdownFolio.theme` | `ivory` | Preview theme (ivory, admiral, serene, cyberpunk, dracula, github) |
| `markdownFolio.headingFont` | Merriweather | Font family for headings |
| `markdownFolio.bodyFont` | DM Sans | Font family for body text |
| `markdownFolio.fontSize` | `16` | Font size in pixels |
| `markdownFolio.headingSize` | `M` | Heading scale: S / M / L |
| `markdownFolio.lineSpacing` | `normal` | Line spacing: compact / normal / relaxed |
| `markdownFolio.pageWidth` | `standard` | Page width: narrow / standard / wide |
| `markdownFolio.scrollSync` | `true` | Enable bi-directional scroll sync |
| `markdownFolio.pasteImage.folder` | `assets` | Folder to save pasted images (relative to the markdown file) |
| `markdownFolio.showToolbar` | `true` | Show/hide the floating toolbar |
| `markdownFolio.showTocSidebar` | `true` | Show/hide the Table of Contents sidebar |

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+V` | Paste image from clipboard into markdown |

---

## Feedback

Found a bug or have a suggestion? [Open an issue on GitHub](https://github.com/BiViPi/markdown-folio/issues).
