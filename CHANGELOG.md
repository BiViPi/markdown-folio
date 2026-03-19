# Changelog

All notable changes to **Markdown Folio** will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.1.0] — 2026-03-19

### Added

**Core Preview**
- Live Markdown preview in a WebView panel with A4-style page layout
- Real-time update on file change (300 ms debounce)
- Dark and light mode with glassmorphic floating toolbar
- Table of Contents sidebar — auto-generated from headings, click-to-scroll
- KaTeX math rendering (inline `$...$` and display `$$...$$`)
- Mermaid diagram support: flowchart, sequence, Gantt, mindmap, gitGraph, pie

**Typography & Layout**
- Default fonts: DM Serif Display (headings), DM Sans (body)
- Configurable: heading font, body font, font size, heading scale, line spacing, page width
- Zoom in/out controls
- Narrow / Standard / Wide page width modes

**Export**
- **PDF** — Puppeteer-based; portrait/landscape, A4/A3/Letter, page number footer
- **HTML** — Self-contained; fonts base64-embedded; KaTeX CSS inline; Mermaid via CDN
- **PNG** — Full-page screenshot at 2× device scale (Retina quality)
- **DOCX** — html-to-docx with OOXML post-processing:
  - Native math via OMML (LaTeX → MathML → OMML pipeline, no Puppeteer required)
  - Mermaid diagrams rendered to PNG via Puppeteer and embedded
  - PNG image dimensions fixed via EMU calculation from raw PNG header
  - Word 365 compatibility fixes: `w:conformance="transitional"`, `xmlns:mc` namespace, `<w:sectPr>` position

**Settings**
- All settings under `markdownFolio.*` namespace, persist via VS Code workspace config
- Settings panel in toolbar syncs live to preview

**Path & Platform**
- Relative image paths resolved to `data:` URI (base64) — works in webview and all export formats
- Windows path handling: `file:///` with forward-slash normalisation for Puppeteer
- Chrome/Chromium auto-detection on Windows, macOS, Linux

---

## Roadmap

- [ ] Icon (128×128 px) for Marketplace listing
- [ ] DOCX: header with project name and date
- [ ] PDF: watermark text option
- [ ] Syntax highlighting for code blocks in DOCX
- [ ] Paste-image support
