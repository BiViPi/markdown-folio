# Changelog

## [1.3.0] - 2026-04-28

### Added
- **Smart Copy Dropdown**: New "Copy" menu offering three context-aware modes:
    - **Rich HTML**: Optimized for pasting into Gmail, Outlook, Word, and Google Docs (supports formatted text and structure).
    - **Notion Markdown**: Clean Markdown source with stripped YAML frontmatter, specifically designed for pasting into Notion blocks.
    - **Plain Text**: Clean visible text extracted directly from the preview.
- **Paste Image from Clipboard**: Use `Ctrl+Alt+V` to automatically save clipboard images to a local `assets/` folder. Images are timestamped to avoid collisions and instantly linked in Markdown.
- **Bi-directional Scroll Sync**: Seamlessly synchronize your position between the Markdown editor and the preview.
    - **Editor to Preview**: The preview automatically scrolls as you move through the source document.
    - **Preview to Editor**: Scrolling the preview reveals the corresponding lines in the visible text editor.
    - Optimized for complex documents containing YAML frontmatter, large code blocks, and Mermaid diagrams.
- **Enhanced Settings UI**: Added granular controls for **Line Spacing** (Compact, Normal, Relaxed) and **Page Width** (Narrow, Standard, Wide) in the preview settings.

## [1.2.1] - 2026-04-25

### Fixed
- PDF export now applies theme-aware colors without forcing the Ivory palette.
- PDF bookmarks now preserve Vietnamese text correctly.
- HTML export now matches the preview layout and active theme more closely.
- PNG export now uses preview styling instead of PDF/Ivory styling.
- PNG full-page and per-page exports now capture the document paper area instead of clipping by viewport.
- PDF export now keeps a white paper background with readable print text; Dracula uses a print-safe accent color.

