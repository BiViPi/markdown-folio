# Changelog

All notable changes to **Markdown Folio** will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.1.0] — 2026-04-06

### Added
- Added quick-access Folio button to the status bar (appears only for Markdown files).
- Added a collapsible toolbar feature in the preview panel. The toolbar can shrink into a small pill at the top-right corner to minimize reading distractions, with its state persisted across sessions.

## [1.0.6] — 2026-03-21

### Added
- Table styling: borders and zebra-stripe backgrounds for better data readability.

### Changed
- Default heading font changed from 'DM Serif Display' to 'Merriweather' for superior Vietnamese character support.
- Mermaid Light Mode theme changed from 'neutral' to 'default' for better aesthetics.

### Fixed
- Preview theme selection (Dark/Light) is now correctly saved to VS Code settings.
- Mermaid theme now correctly initializes and updates when toggling modes.

## [1.0.5] — 2026-03-21

### Fixed
- Consistent GitHub organization name (BiViPi) used across all links (README, package.json).

## [1.0.4] — 2026-03-19

### Fixed
- README links corrected to use the right GitHub username (BiViPi)

## [1.0.3] — 2026-03-19

### Fixed
- README images now display correctly on Open VSX (use absolute GitHub raw URLs)

## [1.0.2] — 2026-03-19

### Fixed
- PDF export crash: "t.mask is not a function" caused by bundled native WebSocket module incompatible with Electron ABI

## [1.0.1] — 2026-03-19

### Added
- PNG export dropdown: Full Page (1 image) and Per Page (A4 pages)

