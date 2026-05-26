import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import katex from 'katex';
import { DocxExporter } from '../src/DocxExporter';
import { PdfExporter } from '../src/PdfExporter';
import { BrowserRasterizer } from '../src/utils/BrowserRasterizer';

describe('DocxExporter', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('strips preview-only inline TOC and header-anchor chrome before DOCX generation', () => {
        const input = [
            '<nav class="auto-toc"><ul><li>TOC</li></ul></nav>',
            '<h2 id="sec">Heading <a class="header-anchor" href="#sec"><svg></svg></a></h2>',
            '<p>Body</p>',
        ].join('');

        const out = DocxExporter.stripPreviewOnlyMarkup(input);

        expect(out).not.toContain('auto-toc');
        expect(out).not.toContain('header-anchor');
        expect(out).toContain('Heading');
        expect(out).toContain('<p>Body</p>');
    });

    it('normalizes unsupported preview HTML into Word-friendly structures', () => {
        const input = [
            '<details><summary>Chi tiết</summary><p>Body</p></details>',
            '<blockquote class="markdown-alert markdown-alert-warning"><p class="markdown-alert-title">Warning</p><p>Alert body</p></blockquote>',
            '<pre><code><span class="hljs-keyword">const</span> x = 1;\nreturn x;</code></pre>',
            '<p><mark>highlight</mark></p>',
        ].join('');

        const out = DocxExporter.normalizeDocxHtml(input, {
            headingFont: "'Georgia', serif",
            bodyFont: "'DM Sans', sans-serif",
        });

        expect(out).toContain('<strong>Chi tiết</strong>');
        expect(out).toContain('<table');
        expect(out).toContain('font-family:Consolas, monospace;');
        expect(out).toContain('const x = 1;<br>return x;');
        expect(out).toContain('background-color:#fff59d;');
    });

    it('applies heading typography from settings inline for DOCX export', () => {
        const input = '<h2 id="sec">Heading</h2>';
        const out = DocxExporter.normalizeDocxHtml(input, {
            headingFont: "'Georgia', serif",
            headingSize: 'M',
        });

        expect(out).toContain('font-family:Georgia;font-size:17pt;');
    });

    it('rasterizes SVG img tags to PNG data URIs before html-to-docx sees them', async () => {
        vi.spyOn(PdfExporter, 'findChromePath').mockReturnValue('C:/Chrome/chrome.exe');
        vi.spyOn(BrowserRasterizer, 'renderAll').mockResolvedValue([
            'data:image/png;base64,RASTERIZED_SVG',
        ]);

        const input = [
            '<p><img alt="Vector" src="data:image/svg+xml;base64,PHN2Zy8+"></p>',
            '<p><img alt="Raster" src="data:image/png;base64,ALREADY_PNG"></p>',
        ].join('');

        const out = await DocxExporter.replaceSvgImagesWithPng(input, '');

        expect(out).toContain('data:image/png;base64,RASTERIZED_SVG');
        expect(out).toContain('data:image/png;base64,ALREADY_PNG');
        expect(out).not.toContain('data:image/svg+xml');
    });

    it('falls back to a text placeholder when SVG images cannot be rasterized', async () => {
        vi.spyOn(PdfExporter, 'findChromePath').mockImplementation(() => {
            throw new Error('Chrome not found');
        });

        const input = '<p><img alt="Tiny data URI" src="data:image/svg+xml;base64,PHN2Zy8+"></p>';
        const out = await DocxExporter.replaceSvgImagesWithPng(input, '');

        expect(out).toContain('[Image: Tiny data URI]');
        expect(out).not.toContain('data:image/svg+xml');
    });

    it('rasterizes KaTeX spans to PNG for DOCX when Chrome is available', async () => {
        vi.spyOn(PdfExporter, 'findChromePath').mockReturnValue('C:/Chrome/chrome.exe');
        vi.spyOn(BrowserRasterizer, 'renderAll').mockResolvedValue([
            'data:image/png;base64,INLINE_MATH',
            'data:image/png;base64,DISPLAY_MATH',
        ]);

        const input = [
            `<p>Inline ${katex.renderToString('E = mc^2', { throwOnError: false })}</p>`,
            katex.renderToString('\\int_0^1 x^2 dx = \\frac{1}{3}', { displayMode: true, throwOnError: false }),
        ].join('');

        const out = await DocxExporter.replaceKatexWithImages(input, 'E:/Extensions/Markdown Folio/markdown-folio/dist', '');

        expect(out).toContain('data:image/png;base64,INLINE_MATH');
        expect(out).toContain('data:image/png;base64,DISPLAY_MATH');
        expect(out).not.toContain('class="katex"');
    });

    it('keeps KaTeX HTML untouched when math rasterization is unavailable so OMML fallback can run', async () => {
        vi.spyOn(PdfExporter, 'findChromePath').mockImplementation(() => {
            throw new Error('Chrome not found');
        });

        const input = `<p>Inline ${katex.renderToString('E = mc^2', { throwOnError: false })}</p>`;
        const out = await DocxExporter.replaceKatexWithImages(input, 'E:/Extensions/Markdown Folio/markdown-folio/dist', '');

        expect(out).toContain('class="katex"');
    });

    it('still rasterizes sanitized KaTeX spans even after annotation nodes are removed', async () => {
        vi.spyOn(PdfExporter, 'findChromePath').mockReturnValue('C:/Chrome/chrome.exe');
        vi.spyOn(BrowserRasterizer, 'renderAll').mockResolvedValue([
            'data:image/png;base64,SANITIZED_INLINE',
        ]);

        const sanitizedLike = '<p>Inline math: <span class="katex"><span class="katex-mathml"><math><mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow>E = mc^2</math></span><span class="katex-html" aria-hidden="true"><span class="base">rendered</span></span></span></p>';
        const out = await DocxExporter.replaceKatexWithImages(sanitizedLike, 'E:/Extensions/Markdown Folio/markdown-folio/dist', '');

        expect(out).toContain('data:image/png;base64,SANITIZED_INLINE');
        expect(out).not.toContain('class="katex"');
    });

    it('replaces unresolved non-image local img sources so html-to-docx does not crash', () => {
        const input = '<p><img src="assets/not-an-image.txt" alt="Not an image"></p>';
        const out = DocxExporter.replaceUnsupportedImages(input);

        expect(out).toContain('[Image: Not an image]');
        expect(out).not.toContain('assets/not-an-image.txt');
    });

    it('removes duplicate w:tblGrid blocks that trigger Word repair dialogs', async () => {
        const zip = new JSZip();
        zip.file(
            'word/document.xml',
            [
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
                '<w:body>',
                '<w:tbl>',
                '<w:tblPr><w:jc w:val="center"/></w:tblPr>',
                '<w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid>',
                '<w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc></w:tr>',
                '<w:tblGrid><w:gridCol w:w="1000"/></w:tblGrid>',
                '<w:tr><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr>',
                '</w:tbl>',
                '</w:body>',
                '</w:document>',
            ].join('')
        );
        zip.file(
            'word/_rels/document.xml.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'
        );

        const raw = await zip.generateAsync({ type: 'nodebuffer' });
        const fixed = await (DocxExporter as any)._fixOoxmlCompat(raw, JSZip, new Map());
        const reparsed = await JSZip.loadAsync(fixed);
        const xml = await reparsed.file('word/document.xml')!.async('text');

        expect((xml.match(/<w:tblGrid>/g) ?? [])).toHaveLength(1);
        expect(xml).toContain('w:conformance="transitional"');
    });
});
