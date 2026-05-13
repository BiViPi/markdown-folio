# Changelog

## [1.4.0] - 2026-05-13

### Added
- TikZ diagram support in preview using system LaTeX (`pdflatex` + `dvisvgm`).
- TikZ export support for HTML, PDF, and PNG via resolved inline SVG.
- TikZ image fallback in DOCX export.
- Reading stats in preview: reading time, word count, and character count.
- Hoverable header deep-links in preview and HTML export.
- Image lightbox in preview.
- Configurable print margin guides in preview.
- Direct export commands for PDF, HTML, DOCX, and PNG.

### Changed
- Browser-based rasterization is now shared between Mermaid and TikZ DOCX export paths.
- Preview lightbox styling was refined to separate screenshots and transparent images more clearly from the canvas background.
- Documentation now includes TikZ setup requirements for LaTeX-based rendering.

### Fixed
- PDF and HTML export commands now work correctly in VSCodium by registering direct command handlers instead of relying only on the preview toolbar flow.
- TikZ rendering now uses a `dvisvgm` invocation compatible with the current MiKTeX toolchain on Windows.
- DOCX export now falls back safely when TikZ or Mermaid rasterization is unavailable.

## [1.3.2] - 2026-05-07

### Changed
- Removed global startup activation and scoped extension activation to the Markdown Folio custom editor to reduce unnecessary startup cost.

## [1.3.1] - 2026-05-07

### Fixed
- Local SVG images now render correctly in preview by resolving local image references to embeddable HTML image tags.
- Floating toolbar collapsed state now persists when switching between Markdown files.
- Preview canvas now uses softer rounded corners for a less rigid frame.
- Toolbar popovers are now centered against their trigger buttons instead of relying on fixed horizontal offsets.

## [1.3.0] - 2026-04-28

### Added
- Smart Copy dropdown with Rich HTML, Notion Markdown, and Plain Text modes.
- Paste Image from Clipboard with automatic `assets/` insertion.
- Bi-directional scroll sync between editor and preview.
- Enhanced preview settings for line spacing and page width.

## [1.2.1] - 2026-04-25

### Fixed
- PDF export now applies theme-aware colors without forcing the Ivory palette.
- PDF bookmarks now preserve Vietnamese text correctly.
- HTML export now matches the preview layout and active theme more closely.
- PNG export now uses preview styling instead of PDF/Ivory styling.
- PNG full-page and per-page exports now capture the document paper area instead of clipping by viewport.
- PDF export now keeps a white paper background with readable print text; Dracula uses a print-safe accent color.
