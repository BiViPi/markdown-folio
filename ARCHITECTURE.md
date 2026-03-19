# Markdown Folio — Architecture & Developer Notes

Tài liệu kỹ thuật nội bộ: kiến trúc, quyết định thiết kế, lỗi đã gặp và cách fix.

---

## Tổng quan kiến trúc

```
Extension Host (Node.js)          WebView (Browser sandbox)
─────────────────────────         ──────────────────────────
extension.ts                      main.ts
  └── PreviewPanel.ts               ├── renderer.ts
        ├── MarkdownEngine.ts       ├── toolbar.ts
        ├── TocGenerator.ts         └── toc.ts
        ├── FrontmatterParser.ts
        ├── SettingsManager.ts
        ├── PathResolver.ts
        ├── HtmlBuilder.ts
        ├── PdfExporter.ts     ──── puppeteer-core
        ├── PngExporter.ts     ──── puppeteer-core
        ├── HtmlExporter.ts
        └── DocxExporter.ts    ──── html-to-docx + jszip + katex
              └── MathMlToOmml.ts
```

**Luồng chính:**
1. User mở `.md` → `PreviewPanel` đọc file, gọi `MarkdownEngine.render()`
2. Host `postMessage({ type: 'render', html, toc, config })` → WebView
3. WebView inject HTML vào `#document-content`, render TOC, run Mermaid
4. User click export → WebView `postMessage({ type: 'export-pdf' | ... })` → Host
5. Host build full HTML (`HtmlBuilder`) → export handler (Puppeteer / html-to-docx / fs.write)

---

## Build system

- **Vite 5** với 2 config tách biệt:
  - `vite.extension.config.ts` — target `node`, bundle `extension.ts` → `dist/extension.js`
  - `vite.webview.config.ts` — target `browser`, bundle `webview/main.ts` → `dist/webview.js`
- Script `scripts/copy-katex-assets.cjs` copy CSS, fonts, Mermaid JS, PDF stylesheet vào `dist/`
- `vscode:prepublish` = `npm run build` → Marketplace luôn nhận bản mới nhất

### Tại sao 2 config Vite?
Extension host chạy Node.js (có `fs`, `path`, `require`), WebView chạy browser sandbox (không có Node built-ins). Nếu dùng 1 bundle sẽ crash do browser không hiểu `require('fs')`.

---

## Các module quan trọng

### `MarkdownEngine.ts`
Wrap `markdown-it` + plugins:
- `markdown-it-anchor` — thêm `id` cho heading để TOC link được
- `markdown-it-toc-done-right` — generate `[[toc]]` inline (không dùng, chỉ load để compatibility)
- `@vscode/markdown-it-katex` — render KaTeX, output `<span class="katex">` với annotation LaTeX

**Lưu ý:** KaTeX render HTML + MathML cùng lúc. Trong DOM sẽ có cả `<span class="katex-html">` (visual) và `<span class="katex-mathml">` (accessibility). DocxExporter dùng annotation XML để lấy lại LaTeX gốc.

### `HtmlBuilder.ts`
Build full standalone HTML cho export (PDF, PNG, HTML file, DOCX mermaid).

**PDF HTML:**
- Đọc `katex.min.css` → inject `<style>`
- Đọc `document.pdf.css` → replace `url('fonts/...')` → base64 font inline
- Inject `<script>` mermaid init + wait signal (`window._mermaidDone`)
- Settings override qua CSS variables (`--font-heading`, `--font-body`, etc.)
- Header template: `<div class="pdf-header">` với page number CSS counter

**Export HTML:**
- Giống PDF HTML nhưng dùng CDN cho Mermaid (không cần `dist/mermaid.min.js`)
- Font base64 inline từ `dist/fonts/` → offline OK

### `DocxExporter.ts`

**Pipeline:**
```
HTML input
  → replaceMermaidWithImages()   // Puppeteer: <pre.mermaid> → <img src="data:png">
  → _replaceKatexWithOmml()      // KaTeX spans → OMML_MARKER_N placeholders
  → html-to-docx(processedHtml) // Generate raw .docx Buffer
  → _fixOoxmlCompat()            // JSZip: patch word/document.xml
      ├── w:conformance="transitional"
      ├── xmlns:ve → xmlns:mc
      ├── Move <w:sectPr> to end of <w:body>
      ├── Strip attrs with "undefined" value
      ├── Fix PNG <wp:extent cx cy> from raw PNG header
      └── Inject OMML formulas (replace markers)
  → write .docx file
```

### `MathMlToOmml.ts`
Custom MathML → OMML converter (không dùng thư viện ngoài — tránh bloat).

Dùng stack-based XML parser tự viết vì MathML từ KaTeX có structure cụ thể:
- `mi/mn/mo/mtext` → `<m:r><m:t>text</m:t></m:r>`
- `mfrac` → `<m:f><m:num>...</m:num><m:den>...</m:den></m:f>`
- `msqrt/mroot` → `<m:rad>`
- `msup/msub/msubsup` → `<m:sSup>/<m:sSub>/<m:sSubSup>`
- `mover/munder` → `<m:acc>` (hat) hoặc `<m:bar>` (overline) hoặc `<m:limLow>`
- `munderover` → `<m:nary>` (integral/sum với limits) hoặc `<m:limLow>`
- `mtable/mtr/mtd` → `<m:m>/<m:mr>/<m:e>` (matrix)
- `semantics` → chỉ lấy con đầu tiên (bỏ qua `<annotation>`)

---

## Lỗi đã gặp và cách fix

### 1. Windows file:// URL — Puppeteer không load được file local

**Triệu chứng:** PDF/PNG export crash trên Windows, Puppeteer báo `net::ERR_FILE_NOT_FOUND`.

**Nguyên nhân:** `file://${tmpFile}` trên Windows tạo ra `file://C:\Users\...` — sai format. Đúng phải là `file:///C:/Users/...` (3 dấu slash + forward slash).

**Fix:**
```typescript
await page.goto(`file:///${tmpFile.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0' });
```

**File liên quan:** `PdfExporter.ts`, `PngExporter.ts` (DocxExporter đã đúng từ đầu).

---

### 2. Word 365 từ chối mở file DOCX

**Triệu chứng:** File DOCX mở được trong LibreOffice nhưng Word 365 báo lỗi corruption.

**Nguyên nhân:** `html-to-docx` generate OOXML không tuân thủ strict spec của Word 365:
- Thiếu `w:conformance="transitional"` trên `<w:document>`
- Dùng prefix `xmlns:ve` cũ thay vì `xmlns:mc` (MarkupCompatibility)
- `<w:sectPr>` đặt ở đầu `<w:body>` thay vì cuối
- Một số attribute có giá trị `"undefined"` (literal string)
- `<wp:extent/>` và `<a:ext/>` rỗng cho embedded PNG images

**Fix:** `_fixOoxmlCompat()` trong `DocxExporter.ts` — post-process `word/document.xml` qua JSZip sau khi html-to-docx generate xong.

---

### 3. KaTeX trong DOCX — 3 lần thử

**Lần 1 (text fallback):** `[formula: latex]` — quá thô.

**Lần 2 (Puppeteer PNG):** Render KaTeX thành ảnh PNG, embed vào DOCX. Vấn đề: Word không handle inline image trong text flow tốt, formula bị vỡ layout khi có nhiều text xung quanh. Còn chậm vì cần Puppeteer thêm 1 lần nữa.

**Lần 3 (OMML native — hiện tại):** Extract LaTeX từ `<annotation encoding="application/x-tex">` trong KaTeX output → `katex.renderToString(latex, {output: 'mathml'})` → `MathMlToOmml.convert()` → inject `<m:oMath>` trực tiếp vào `word/document.xml`.
- Không cần Puppeteer cho KaTeX
- Word hiểu OMML natively → đẹp, đúng vị trí, editable

**Cách inject OMML:**
1. Thay thế mỗi `<span class="katex">` bằng placeholder `OMML_MARKER_N` trong HTML trước khi pass vào html-to-docx
2. Sau khi html-to-docx tạo DOCX, dùng JSZip đọc `word/document.xml`
3. Tìm marker trong XML, replace `<w:r>` chứa marker bằng `<m:oMath>` (inline) hoặc `<w:p>...<m:oMathPara>` (display, centered)

**Bug quan trọng:** `lastIndexOf('<w:p', idx)` match được cả `<w:pPr>` — phải dùng:
```typescript
Math.max(before.lastIndexOf('<w:p>'), before.lastIndexOf('<w:p '))
```

---

### 4. Toolbar centering — lệch khi có TOC sidebar

**Triệu chứng:** Toolbar `position: fixed; left: 50%; transform: translateX(-50%)` canh giữa viewport. Khi TOC sidebar (240px) hiển thị, vùng document bị đẩy phải → toolbar không canh giữa trang nữa.

**Fix:** ResizeObserver theo dõi `#document-container`, tính lại `left` bằng JS:
```typescript
function syncToolbarPosition() {
    const rect = document.getElementById('document-container')!.getBoundingClientRect();
    document.getElementById('toolbar')!.style.left = `${rect.left + rect.width / 2}px`;
}
new ResizeObserver(syncToolbarPosition).observe(document.getElementById('document-container')!);
```
Gọi thêm `setTimeout(syncToolbarPosition, 50)` sau mỗi render (TOC sidebar show/hide thay đổi layout chậm 1 frame).

---

### 5. PNG image dimensions rỗng trong DOCX

**Triệu chứng:** Ảnh PNG embed vào DOCX nhưng hiển thị kích thước 0×0 trong Word.

**Nguyên nhân:** html-to-docx generate `<wp:extent/>` và `<a:ext/>` rỗng (không có cx, cy).

**Fix:** Đọc raw PNG bytes từ JSZip, parse PNG header (bytes 16–23 là width và height dạng big-endian uint32), tính EMU (1 pixel = 9525 EMU tại 96 dpi), inject vào XML:
```typescript
const w = imgBuf.readUInt32BE(16);
const h = imgBuf.readUInt32BE(20);
// cx = w * 9525, cy = h * 9525
```

---

### 6. Mermaid re-render sau theme switch

**Triệu chứng:** Sau khi toggle dark/light mode, Mermaid diagram không re-render với theme mới.

**Fix:** Trước khi `mermaid.run()`, remove attribute `data-processed` khỏi mỗi element và re-initialize với theme mới:
```typescript
el.removeAttribute('data-processed');
mermaid.initialize({ startOnLoad: false, theme: isLight ? 'neutral' : 'dark', securityLevel: 'loose' });
mermaid.run({ nodes });
```

---

## Tech stack

| Layer | Package | Ghi chú |
|-------|---------|---------|
| Bundler | Vite 5 + esbuild | 2 config: Node (extension) + Browser (webview) |
| Markdown | markdown-it 14 | + anchor + katex plugins |
| Diagrams | mermaid 11 | Bundle vào webview; copy `mermaid.min.js` vào dist cho export |
| Math | @vscode/markdown-it-katex | Output HTML + MathML annotation |
| DOCX | html-to-docx 1.x + jszip | html-to-docx generate → jszip post-process |
| Math DOCX | katex (renderToString mathml) + MathMlToOmml | Tự viết converter, ~350 LOC |
| PDF/PNG | puppeteer-core 22 | Dùng Chrome có sẵn trên máy user |
| Fonts | @fontsource/* | Build time only — base64 inline vào CSS |
| Language | TypeScript 5 | Strict mode |

---

## Deployment checklist (trước khi publish Marketplace)

- [ ] Thêm icon `icon.png` 128×128 px, khai báo trong `package.json`
- [ ] Cập nhật `repository.url` trong `package.json` thành URL thật
- [ ] Chạy `vsce package` và test file `.vsix` cài vào VS Code fresh
- [ ] Test trên macOS và Linux (Chrome path detection)
- [ ] Viết screenshot cho Marketplace (toolbar, dark mode, export dialog)
- [ ] Đặt `galleryBanner.color` đúng với branding
