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

**GitHub Alerts + TikZ**
![GitHub Alerts and TikZ](https://raw.githubusercontent.com/BiViPi/markdown-folio/main/images/github-alerts-tikz.png)

---

## Features

### 📄 Export
- **Multi-Format Export** — PDF (A4/A3/Letter, portrait/landscape), Word (DOCX), HTML, and PNG in one click

### 🔢 Rendering
- **Math Formulas** — Full KaTeX support for inline `$...$` and display `$$...$$` equations, rendered natively in Word
- **Mermaid Diagrams** — Flowchart, sequence, Gantt, mindmap, gitGraph, and more
- **TikZ Diagrams** — Geometry and technical diagrams rendered through a local LaTeX toolchain, with hybrid shaded-diagram support and export coverage for HTML, PDF, PNG, and DOCX image fallback
- **GitHub Alerts** — Native support for `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, and `CAUTION` blockquote alerts with icons and GitHub-like accents

### 🎨 Appearance
- **6 Professional Themes** — Ivory, Admiral, Serene, Cyberpunk, Dracula, and GitHub
- **Typography** — Configurable heading/body fonts, font size, heading scale, line spacing, and page width
- **Custom Stylesheet** — Apply a local CSS file after the built-in styles for preview, HTML export, and PDF export
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
>
> TikZ blocks require `pdflatex` and `dvisvgm` to be available on your `PATH`. On Windows, install **MiKTeX** or **TeX Live**. On the first TikZ render, MiKTeX may also prompt you to install missing LaTeX packages such as `preview`; accept those installs.

---

## Custom Stylesheet

Use `markdownFolio.customStyleSheet` to point Markdown Folio at a local CSS file. The stylesheet is applied after the built-in styles in preview, HTML export, and PDF export.

Notes:

- Relative paths resolve from the first workspace folder.
- Preview reloads the stylesheet when the file changes on disk.
- `DOCX` does not guarantee CSS parity.

## GitHub Alerts

Markdown Folio supports GitHub-style alert blockquotes:

```md
> [!NOTE]
> Helpful information for the reader.
```

Supported alert types:

- `NOTE`
- `TIP`
- `IMPORTANT`
- `WARNING`
- `CAUTION`

## Settings

| Setting | Default | Description |
|---|---|---|
| `markdownFolio.theme` | `ivory` | Preview theme (ivory, admiral, serene, cyberpunk, dracula, github) |
| `markdownFolio.headingFont` | Merriweather | Font family for headings |
| `markdownFolio.bodyFont` | DM Sans | Font family for body text |
| `markdownFolio.customStyleSheet` | `""` | Path to a custom CSS file applied after built-in preview, HTML export, and PDF export styles |
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
