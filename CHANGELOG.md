# Changelog

## [1.5.3] - 2026-05-25

### Fixed
- PDF export now waits for custom fonts to finish loading before printing, so heading fonts from `markdownFolio.customStyleSheet` apply reliably in the exported PDF.

## [1.5.2] - 2026-05-21

### Fixed
- Restored the full packaged `node-tikzjax` runtime dependency tree so shaded TikZ diagrams render correctly from the installed VSIX, including the visible spectrum/gradient case.

## [1.5.1] - 2026-05-21

### Fixed
- Bundled the full `node-tikzjax` runtime dependency tree inside the packaged extension so shaded TikZ diagrams render correctly after installing the VSIX from VS Code or Open VSX.

## [1.5.0] - 2026-05-21

### Added
- New `markdownFolio.customStyleSheet` setting to apply a user CSS file to preview, HTML export, and PDF export.
- GitHub-style alerts for `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, and `CAUTION`.
- Alert icons and GitHub-like default alert accents in preview and PDF export.

### Changed
- Preview now reloads custom CSS when the configured stylesheet file changes on disk.
- Shaded TikZ blocks now use a hybrid backend so gradient-heavy diagrams can render correctly without changing the standard TikZ pipeline.

### Fixed
- TikZ SVG output now preserves authored colors in dark themes instead of applying blanket inversion.
- Shaded TikZ spectrum/gradient output now renders correctly in preview, HTML, PDF, PNG, and DOCX export paths.
- HTML, PDF, and PNG exports now share custom stylesheet overrides with preview more consistently.
- GitHub alert titles no longer duplicate their labels during markdown rendering.
- PDF code block styling now stays closer to the preview theme instead of falling back to mismatched colors.

## [1.4.1] - 2026-05-17

### Added
- New `markdownFolio.chromePath` configuration allowing custom executable paths for Google Chrome or Chromium.

### Changed
- Automatic Chrome detection now actively scans the user-level `/Applications` folder on macOS to support non-admin installations.

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
