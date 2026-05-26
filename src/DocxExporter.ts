import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import HTMLtoDOCX from 'html-to-docx';
import JSZip from 'jszip';
import katex from 'katex';
import { PdfExporter } from './PdfExporter';
import { PdfSettings } from './HtmlBuilder';
import { MathMlToOmml } from './MathMlToOmml';
import { BrowserRasterizer, RasterizeJob } from './utils/BrowserRasterizer';

export interface DocxOptions {
    outputPath: string;
    title?: string;
    distDir: string;
    settings?: PdfSettings;
    chromePath?: string;
}

type OmmlMap = Map<number, { omml: string; isDisplay: boolean }>;

export class DocxExporter {
    static async export(html: string, options: DocxOptions): Promise<void> {
        const { processed, ommlMap } = await DocxExporter._preprocess(html, options.distDir, options.settings, options.chromePath);
        const docxFont = DocxExporter._primaryFontFamily(options.settings?.bodyFont, 'Calibri');
        const docxFontSize = options.settings?.fontSize
            ? Math.round(options.settings.fontSize * 1.5) // 1 px ≈ 0.75 pt, DOCX uses half-points
            : 22;

        const rawBuffer: Buffer = await HTMLtoDOCX(processed, undefined, {
            title: options.title || 'Document',
            font: docxFont,
            fontSize: docxFontSize,
            margins: { top: 1080, bottom: 1080, left: 1134, right: 1134, header: 720, footer: 720, gutter: 0 },
            table: { row: { cantSplit: true } },
        });

        const fixedBuffer = await DocxExporter._fixOoxmlCompat(rawBuffer, JSZip, ommlMap);
        fs.writeFileSync(options.outputPath, fixedBuffer);
    }

    /**
     * Fix OOXML conformance issues that cause Word 365 to reject the file:
     * 1. <w:sectPr> at start of <w:body> instead of end
     * 2. Missing w:conformance="transitional" on <w:document>
     * 3. xmlns:ve= (old prefix) instead of xmlns:mc= for MarkupCompatibility
     * 4. Attributes with literal "undefined" value
     * 5. Empty <wp:extent/> and <a:ext/> for embedded PNG images
     * 6. Duplicate <w:tblGrid> blocks emitted inside a single table
     * 7. OMML formula injection (replacing OMML_MARKER_N placeholders)
     */
    private static async _fixOoxmlCompat(buffer: Buffer, JSZip: any, ommlMap: OmmlMap): Promise<Buffer> {
        const zip = await JSZip.loadAsync(buffer);
        const docXml: string = await zip.file('word/document.xml').async('text');

        let fixed = docXml;

        // Fix 1: w:conformance="transitional"
        fixed = fixed.replace('<w:document ', '<w:document w:conformance="transitional" ');

        // Fix 2: xmlns:ve → xmlns:mc
        fixed = fixed.replace(
            'xmlns:ve="http://schemas.openxmlformats.org/markup-compatibility/2006"',
            'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"'
        );
        fixed = fixed.replace(/\bve:/g, 'mc:');

        // Fix 3: Move <w:sectPr> from start to end of <w:body>
        const sectPrRegex = /(<w:body>)\s*(<w:sectPr[\s\S]*?<\/w:sectPr>)\s*/;
        const sectPrMatch = fixed.match(sectPrRegex);
        if (sectPrMatch) {
            const sectPr = sectPrMatch[2];
            fixed = fixed.replace(sectPrRegex, '$1\n');
            fixed = fixed.replace('</w:body>', `  ${sectPr}\n</w:body>`);
        }

        // Fix 4: Strip attributes with literal "undefined" value
        fixed = fixed.replace(/\s+\w+:\w+="undefined"/g, '');

        // Fix 5: Set <wp:extent cx cy> and <a:ext cx cy> for embedded PNG images
        const relsXml: string = await zip.file('word/_rels/document.xml.rels').async('text');
        const rIdToFile = new Map<string, string>();
        const relRe = /Id="(rId\d+)"[^>]*Type="[^"]*\/image"[^>]*Target="([^"]+)"/g;
        let rm: RegExpExecArray | null;
        while ((rm = relRe.exec(relsXml)) !== null) { rIdToFile.set(rm[1], rm[2]); }

        const rIdToDims = new Map<string, { cx: number; cy: number }>();
        for (const [rId, imgPath] of rIdToFile) {
            const imgFile = zip.file(`word/${imgPath}`);
            if (!imgFile) { continue; }
            const imgBuf: Buffer = await imgFile.async('nodebuffer');
            if (imgBuf[0] === 0x89 && imgBuf[1] === 0x50) { // PNG magic bytes
                const w = imgBuf.readUInt32BE(16);
                const h = imgBuf.readUInt32BE(20);
                rIdToDims.set(rId, { cx: w * 9525, cy: h * 9525 }); // 1px = 9525 EMU at 96dpi
            }
        }

        fixed = fixed.replace(/<w:drawing>[\s\S]*?<\/w:drawing>/g, (drawingXml) => {
            const blipM = drawingXml.match(/r:embed="(rId\d+)"/);
            if (!blipM) { return drawingXml; }
            const dims = rIdToDims.get(blipM[1]);
            if (!dims) { return drawingXml; }
            const { cx, cy } = dims;
            return drawingXml
                .replace('<wp:extent/>', `<wp:extent cx="${cx}" cy="${cy}"/>`)
                .replace('<a:ext/>', `<a:ext cx="${cx}" cy="${cy}"/>`);
        });

        // Fix 6: html-to-docx can duplicate <w:tblGrid> inside later rows.
        // Word 365 repairs these as "Table Properties" and treats the file as
        // unreadable. Keep only the first grid per table.
        fixed = fixed.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (tableXml) => {
            let seenGrid = false;
            return tableXml.replace(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/g, (gridXml) => {
                if (seenGrid) { return ''; }
                seenGrid = true;
                return gridXml;
            });
        });

        // Fix 7: Inject OMML formulas (replace OMML_MARKER_N placeholders)
        if (ommlMap.size > 0) {
            // Add math namespace to <w:document> if missing
            if (!fixed.includes('xmlns:m=')) {
                fixed = fixed.replace(
                    '<w:document ',
                    '<w:document xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" '
                );
            }

            for (const [id, { omml, isDisplay }] of ommlMap) {
                fixed = DocxExporter._injectOmml(fixed, `OMML_MARKER_${id}`, omml, isDisplay);
            }
        }

        zip.file('word/document.xml', fixed);
        const out: Buffer = await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 },
        });
        return out;
    }

    /**
     * Find marker in document.xml and replace the containing <w:r> (inline)
     * or <w:p> (display) with OMML XML.
     */
    private static _injectOmml(xml: string, marker: string, omml: string, isDisplay: boolean): string {
        const markerIdx = xml.indexOf(marker);
        if (markerIdx === -1) { return xml; }

        if (isDisplay) {
            // Use both '<w:p>' and '<w:p ' to avoid matching '<w:pPr>' etc.
            const before = xml.slice(0, markerIdx);
            const pStart = Math.max(before.lastIndexOf('<w:p>'), before.lastIndexOf('<w:p '));
            const pEnd = xml.indexOf('</w:p>', markerIdx) + 6;
            if (pStart === -1 || pEnd < 6) { return xml; }
            const replacement = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><m:oMathPara><m:oMath>${omml}</m:oMath></m:oMathPara></w:p>`;
            return xml.slice(0, pStart) + replacement + xml.slice(pEnd);
        } else {
            // Use '<w:r>' and '<w:r ' to avoid matching '<w:rPr>' etc.
            const before = xml.slice(0, markerIdx);
            const rStart = Math.max(before.lastIndexOf('<w:r>'), before.lastIndexOf('<w:r '));
            const rEnd = xml.indexOf('</w:r>', markerIdx) + 6;
            if (rStart === -1 || rEnd < 6) { return xml; }
            return xml.slice(0, rStart) + `<m:oMath>${omml}</m:oMath>` + xml.slice(rEnd);
        }
    }

    /**
     * Pre-process HTML:
     * 1. Remove preview-only chrome (inline TOC, anchor icons)
     * 2. Mermaid code blocks → PNG images via BrowserRasterizer
     * 3. TikZ diagram blocks → PNG images via BrowserRasterizer
     * 4. SVG <img> sources → PNG images via BrowserRasterizer
     * 5. KaTeX HTML → PNG images via BrowserRasterizer
     * 6. Remaining KaTeX HTML → OMML marker placeholders (fallback)
     */
    private static async _preprocess(
        html: string,
        distDir: string,
        settings?: PdfSettings,
        chromePath?: string
    ): Promise<{ processed: string; ommlMap: OmmlMap }> {
        let processed = DocxExporter.stripPreviewOnlyMarkup(html);
        processed = await DocxExporter.replaceMermaidWithImages(processed, distDir, chromePath);
        processed = await DocxExporter.replaceTikzWithImages(processed, distDir, chromePath);
        processed = DocxExporter.replaceTikzErrorBlocks(processed);
        processed = await DocxExporter.replaceSvgImagesWithPng(processed, chromePath);
        processed = await DocxExporter.replaceKatexWithImages(processed, distDir, chromePath);
        processed = DocxExporter.replaceUnsupportedImages(processed);
        processed = DocxExporter.normalizeDocxHtml(processed, settings);
        const { processed: withMarkers, ommlMap } = DocxExporter._replaceKatexWithOmml(processed);
        return { processed: withMarkers, ommlMap };
    }

    /**
     * DOCX should follow the main document flow, not preview-only affordances.
     * Remove inline TOC blocks and header-anchor chrome before handing HTML to
     * html-to-docx.
     */
    static stripPreviewOnlyMarkup(html: string): string {
        return html
            .replace(/<nav[^>]*class="[^"]*\bauto-toc\b[^"]*"[^>]*>[\s\S]*?<\/nav>/gi, '')
            .replace(/<div[^>]*class="[^"]*\bauto-toc\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
            .replace(/<a[^>]*class="[^"]*\bheader-anchor\b[^"]*"[^>]*>[\s\S]*?<\/a>/gi, '');
    }

    static normalizeDocxHtml(html: string, settings?: PdfSettings): string {
        let normalized = html;
        normalized = DocxExporter._normalizeDetails(normalized, settings);
        normalized = DocxExporter._normalizeAlerts(normalized, settings);
        normalized = DocxExporter._normalizeBlockquotes(normalized, settings);
        normalized = DocxExporter._normalizeCodeBlocks(normalized);
        normalized = DocxExporter._normalizeInlineCode(normalized);
        normalized = DocxExporter._normalizeMark(normalized);
        normalized = DocxExporter._applyDocxTypography(normalized, settings);
        return normalized;
    }

    /**
     * Replace KaTeX HTML spans with OMML placeholder markers.
     * Converts LaTeX → MathML (KaTeX) → OMML (MathMlToOmml) synchronously.
     * No browser required.
     */
    private static _replaceKatexWithOmml(html: string): { processed: string; ommlMap: OmmlMap } {
        const ommlMap: OmmlMap = new Map();
        const entries = DocxExporter._extractKatexEntries(html).filter(entry => entry.latex);

        if (entries.length === 0) { return { processed: html, ommlMap }; }

        // Replace from end to preserve string indices
        let processed = html;
        for (let k = entries.length - 1; k >= 0; k--) {
            const { start, end, id, isDisplay, latex } = entries[k];
            let omml = '';
            try {
                const mmlResult = katex.renderToString(latex, { output: 'mathml', throwOnError: false });
                omml = MathMlToOmml.convert(mmlResult);
            } catch {
                // omml stays empty — marker injection will be skipped
            }
            ommlMap.set(id, { omml, isDisplay });
            const marker = `OMML_MARKER_${id}`;
            // Display math in own <p> so html-to-docx generates a separate paragraph
            const replacement = isDisplay
                ? `<p><code>${marker}</code></p>`
                : `<code>${marker}</code>`;
            processed = processed.slice(0, start) + replacement + processed.slice(end);
        }

        return { processed, ommlMap };
    }

    /**
     * Word 365 renders raster math more reliably than the current OMML path for
     * complex fixture content. Keep OMML as a fallback only if rasterization is
     * unavailable for a given equation.
     */
    static async replaceKatexWithImages(html: string, distDir: string, chromePathSetting?: string): Promise<string> {
        const entries = DocxExporter._extractKatexEntries(html);
        if (entries.length === 0) { return html; }

        let chromePath: string;
        try {
            chromePath = PdfExporter.findChromePath(chromePathSetting);
        } catch {
            return html;
        }

        const katexCssUrl = pathToFileURL(path.join(distDir, 'katex.css')).href;
        const jobs: RasterizeJob[] = entries.map(entry => ({
            html: `<!DOCTYPE html><html><head>
                <link rel="stylesheet" href="${katexCssUrl}">
                <style>
                    html, body { margin: 0; padding: 0; background: white; display: inline-block; }
                    .math-inline { display: inline-block; padding: 2px 0; }
                    .math-display { display: inline-block; padding: 4px 0; }
                </style>
            </head><body>
                <div class="${entry.isDisplay ? 'math-display' : 'math-inline'}">${entry.html}</div>
                <script>
                    window._fontsDone = false;
                    if (document.fonts && document.fonts.ready) {
                        document.fonts.ready.then(function(){ window._fontsDone = true; }).catch(function(){ window._fontsDone = true; });
                    } else {
                        window._fontsDone = true;
                    }
                <\/script>
            </body></html>`,
            selector: entry.isDisplay ? '.math-display' : '.math-inline',
            waitCondition: 'window._fontsDone === true',
            timeout: 15_000,
        }));

        let images: Array<string | null>;
        try {
            images = await BrowserRasterizer.renderAll(chromePath, jobs, { pageWidth: 1200, pageHeight: 600, scaleFactor: 2 });
        } catch {
            return html;
        }

        let resolved = html;
        for (let i = entries.length - 1; i >= 0; i--) {
            const imgSrc = images[i];
            if (!imgSrc) {
                continue;
            }
            const replacement = entries[i].isDisplay
                ? `<p><img src="${imgSrc}" style="display:block;margin:8px auto;max-width:100%;"></p>`
                : `<img src="${imgSrc}" style="display:inline-block;vertical-align:middle;max-width:100%;">`;
            resolved = resolved.slice(0, entries[i].start) + replacement + resolved.slice(entries[i].end);
        }
        return resolved;
    }

    /**
     * Render each Mermaid diagram to PNG via BrowserRasterizer, replace code block with <img>.
     * Falls back to text placeholder if Chrome is not available.
     */
    static async replaceMermaidWithImages(html: string, distDir: string, chromePathSetting?: string): Promise<string> {
        const sources = DocxExporter._extractMermaidSources(html);
        if (sources.length === 0) { return html; }

        let chromePath: string;
        try {
            chromePath = PdfExporter.findChromePath(chromePathSetting);
        } catch {
            return DocxExporter._mermaidFallback(html);
        }

        const mermaidJsUrl = pathToFileURL(path.join(distDir, 'mermaid.min.js')).href;

        const jobs: RasterizeJob[] = sources.map(source => ({
            html: `<!DOCTYPE html><html><head><style>
                body { margin: 0; padding: 8px; background: white; }
                .mermaid { display: inline-block; }
                .mermaid svg { display: block; max-width: 100%; height: auto; }
            </style></head><body>
                <div class="mermaid">${source}</div>
                <script src="${mermaidJsUrl}"><\/script>
                <script>
                    window._done = false;
                    mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
                    mermaid.run({ querySelector: '.mermaid' })
                        .then(function() { window._done = true; })
                        .catch(function() { window._done = true; });
                <\/script>
            </body></html>`,
            selector: '.mermaid svg',
            waitCondition: 'window._done === true',
            timeout: 15_000,
        }));

        let images: Array<string | null>;
        try {
            images = await BrowserRasterizer.renderAll(chromePath, jobs);
        } catch {
            return DocxExporter._mermaidFallback(html);
        }

        let idx = 0;
        return html.replace(
            DocxExporter._mermaidBlockRegex(),
            (_match, content) => {
                const imgSrc = images[idx++];
                if (imgSrc) {
                    return `<img src="${imgSrc}" style="max-width:100%;display:block;margin:8px 0;">`;
                }
                const firstLine = (content as string).trim().split('\n')[0] || 'diagram';
                return `<p><em>[Diagram: ${firstLine}]</em></p>`;
            }
        );
    }

    /**
     * Rasterize each rendered TikZ SVG block to PNG for DOCX embedding.
     * TikZ is already resolved to inline SVG by the time DOCX export runs.
     * Falls back to a text placeholder if Chrome is not available.
     */
    static async replaceTikzWithImages(html: string, distDir: string, chromePathSetting?: string): Promise<string> {
        const blocks = DocxExporter._extractTikzBlocks(html);
        if (blocks.length === 0) { return html; }

        let chromePath: string;
        try {
            chromePath = PdfExporter.findChromePath(chromePathSetting);
        } catch {
            return DocxExporter._tikzFallback(html);
        }

        const tikzJaxFontCss = DocxExporter._readTikzJaxFontCss(distDir);

        // Each job wraps the raw SVG in a minimal white-background HTML page.
        const jobs: RasterizeJob[] = blocks.map(b => ({
            html: `<!DOCTYPE html><html><head><style>
                html, body { margin: 0; padding: 0; background: white; display: inline-block; }
                svg { display: block; }
            </style>${tikzJaxFontCss ? `<style>${tikzJaxFontCss}</style>` : ''}</head><body>${b.svg}</body></html>`,
            selector: 'svg',
        }));

        let images: Array<string | null>;
        try {
            images = await BrowserRasterizer.renderAll(chromePath, jobs);
        } catch {
            return DocxExporter._tikzFallback(html);
        }

        let resolved = html;
        // Replace from end to preserve string indices.
        for (let i = blocks.length - 1; i >= 0; i--) {
            const imgSrc = images[i];
            const replacement = imgSrc
                ? `<img src="${imgSrc}" style="max-width:100%;display:block;margin:8px 0;">`
                : `<p><em>[TikZ diagram]</em></p>`;
            resolved = resolved.slice(0, blocks[i].start) + replacement + resolved.slice(blocks[i].end);
        }
        return resolved;
    }

    /**
     * html-to-docx writes malformed OOXML image parts for SVG <img> sources
     * (notably ".svg+xml" targets with no matching content type). Convert them
     * to PNG ahead of DOCX generation so Word 365 can open the package cleanly.
     */
    static async replaceSvgImagesWithPng(html: string, chromePathSetting?: string): Promise<string> {
        const images = DocxExporter._extractSvgImageTags(html);
        if (images.length === 0) { return html; }

        let chromePath: string;
        try {
            chromePath = PdfExporter.findChromePath(chromePathSetting);
        } catch {
            return DocxExporter._svgImageFallback(html, images);
        }

        const jobs: RasterizeJob[] = images.map(image => ({
            html: `<!DOCTYPE html><html><head><style>
                html, body { margin: 0; padding: 0; background: white; display: inline-block; }
                img { display: block; max-width: none; }
            </style></head><body><img src="${DocxExporter._escapeHtmlAttr(image.src)}"></body></html>`,
            selector: 'img',
        }));

        let rasterized: Array<string | null>;
        try {
            rasterized = await BrowserRasterizer.renderAll(chromePath, jobs);
        } catch {
            return DocxExporter._svgImageFallback(html, images);
        }

        let resolved = html;
        for (let i = images.length - 1; i >= 0; i--) {
            const replacement = rasterized[i]
                ? DocxExporter._replaceImgSrc(images[i].tag, rasterized[i]!)
                : DocxExporter._svgImagePlaceholder(images[i].alt);
            resolved = resolved.slice(0, images[i].start) + replacement + resolved.slice(images[i].end);
        }
        return resolved;
    }

    /**
     * html-to-docx crashes on unresolved local <img> tags that still point at
     * non-image files such as `.txt`. Keep safe image sources only.
     */
    static replaceUnsupportedImages(html: string): string {
        return html.replace(/<img\b[^>]*>/gi, (tag) => {
            const srcMatch = tag.match(/\bsrc=(["'])([^"']+)\1/i);
            if (!srcMatch) {
                return tag;
            }
            const src = srcMatch[2];
            if (DocxExporter._isDocxSafeImageSource(src)) {
                return tag;
            }
            const altMatch = tag.match(/\balt=(["'])([\s\S]*?)\1/i);
            return DocxExporter._svgImagePlaceholder(altMatch?.[2] ?? 'image');
        });
    }

    /**
     * DOCX should not preserve preview-only TikZ error UI.
     * Replace unresolved/unavailable TikZ blocks with a plain text fallback.
     */
    static replaceTikzErrorBlocks(html: string): string {
        const blocks = DocxExporter._extractTikzErrorBlocks(html);
        if (blocks.length === 0) { return html; }

        let resolved = html;
        for (let i = blocks.length - 1; i >= 0; i--) {
            resolved = resolved.slice(0, blocks[i].start) +
                `<p><em>[TikZ diagram]</em></p>` +
                resolved.slice(blocks[i].end);
        }
        return resolved;
    }

    private static _mermaidFallback(html: string): string {
        return html.replace(
            DocxExporter._mermaidBlockRegex(),
            (_match, content) => {
                const firstLine = (content as string).trim().split('\n')[0] || 'diagram';
                return `<p><em>[Diagram: ${firstLine}]</em></p>`;
            }
        );
    }

    private static _tikzFallback(html: string): string {
        return html.replace(
            DocxExporter._tikzBlockRegex(),
            () => `<p><em>[TikZ diagram]</em></p>`
        );
    }

    private static _mermaidBlockRegex(): RegExp {
        return /(?:<pre[^>]*>\s*<code[^>]*class="[^"]*language-mermaid[^"]*"[^>]*>([\s\S]*?)<\/code>\s*<\/pre>)|(?:<div[^>]*class="[^"]*\bmermaid\b[^"]*"[^>]*>([\s\S]*?)<\/div>)/g;
    }

    private static _tikzBlockRegex(): RegExp {
        return /<div[^>]*class="[^"]*\btikz-diagram\b[^"]*"[^>]*>[\s\S]*?<\/div>/g;
    }

    private static _extractMermaidSources(html: string): string[] {
        const blockRegex = DocxExporter._mermaidBlockRegex();
        const sources: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = blockRegex.exec(html)) !== null) {
            sources.push((m[1] || m[2] || '').trim());
        }
        return sources;
    }

    /**
     * Extract all `.tikz-diagram` blocks with their SVG content and string positions.
     * Positions allow in-place replacement without regex index drift.
     */
    private static _extractTikzBlocks(html: string): Array<{ start: number; end: number; svg: string }> {
        const blocks: Array<{ start: number; end: number; svg: string }> = [];
        // Match <div class="tikz-diagram" ...> ... </div>
        // The content may span many lines; close-tag detection via a balanced approach.
        const openRe = /<div[^>]*class="[^"]*\btikz-diagram\b[^"]*"[^>]*>/g;
        let m: RegExpExecArray | null;

        while ((m = openRe.exec(html)) !== null) {
            const blockStart = m.index;
            const afterOpen = m.index + m[0].length;
            // Find the matching </div> by tracking nesting depth.
            let depth = 1;
            let pos = afterOpen;
            while (pos < html.length && depth > 0) {
                const nextOpen = html.indexOf('<div', pos);
                const nextClose = html.indexOf('</div>', pos);
                if (nextClose === -1) { pos = html.length; break; }
                if (nextOpen !== -1 && nextOpen < nextClose) {
                    depth++;
                    pos = nextOpen + 4;
                } else {
                    depth--;
                    pos = nextClose + 6;
                }
            }
            const blockEnd = pos;
            const innerContent = html.slice(afterOpen, blockEnd - 6); // strip trailing </div>

            // Extract the first <svg>...</svg> from within the block.
            const svgMatch = innerContent.match(/<svg[\s\S]*<\/svg>/i);
            if (svgMatch) {
                blocks.push({ start: blockStart, end: blockEnd, svg: svgMatch[0] });
            }
        }

        return blocks;
    }

    private static _extractTikzErrorBlocks(html: string): Array<{ start: number; end: number }> {
        const blocks: Array<{ start: number; end: number }> = [];
        const openRe = /<div[^>]*class="[^"]*\btikz-error\b[^"]*"[^>]*>/g;
        let m: RegExpExecArray | null;

        while ((m = openRe.exec(html)) !== null) {
            const blockStart = m.index;
            const afterOpen = m.index + m[0].length;
            let depth = 1;
            let pos = afterOpen;
            while (pos < html.length && depth > 0) {
                const nextOpen = html.indexOf('<div', pos);
                const nextClose = html.indexOf('</div>', pos);
                if (nextClose === -1) { pos = html.length; break; }
                if (nextOpen !== -1 && nextOpen < nextClose) {
                    depth++;
                    pos = nextOpen + 4;
                } else {
                    depth--;
                    pos = nextClose + 6;
                }
            }
            if (depth === 0) {
                blocks.push({ start: blockStart, end: pos });
            }
        }

        return blocks;
    }

    private static _extractSvgImageTags(html: string): Array<{ start: number; end: number; tag: string; src: string; alt: string }> {
        const images: Array<{ start: number; end: number; tag: string; src: string; alt: string }> = [];
        const imgRe = /<img\b[^>]*\bsrc=(["'])([^"']+)\1[^>]*>/gi;
        let m: RegExpExecArray | null;
        while ((m = imgRe.exec(html)) !== null) {
            const tag = m[0];
            const src = m[2];
            if (!DocxExporter._isSvgImageSource(src)) {
                continue;
            }
            const altMatch = tag.match(/\balt=(["'])([\s\S]*?)\1/i);
            images.push({
                start: m.index,
                end: m.index + tag.length,
                tag,
                src,
                alt: altMatch?.[2] ?? 'image',
            });
        }
        return images;
    }

    private static _extractKatexEntries(html: string): Array<{
        start: number;
        end: number;
        id: number;
        html: string;
        latex: string;
        isDisplay: boolean;
    }> {
        const entries: Array<{
            start: number;
            end: number;
            id: number;
            html: string;
            latex: string;
            isDisplay: boolean;
        }> = [];
        let nextId = 0;
        let i = 0;

        while (i < html.length) {
            const spanStart = html.indexOf('<span', i);
            if (spanStart === -1) { break; }
            const tagEnd = html.indexOf('>', spanStart);
            if (tagEnd === -1) { break; }
            const openTag = html.slice(spanStart, tagEnd + 1);

            if (/class="[^"]*\bkatex\b/.test(openTag) &&
                !/class="[^"]*katex-html/.test(openTag) &&
                !/class="[^"]*katex-mathml/.test(openTag)) {

                const isDisplay = /class="[^"]*katex-display/.test(openTag);

                let depth = 1;
                let j = tagEnd + 1;
                while (j < html.length && depth > 0) {
                    const nextOpen = html.indexOf('<span', j);
                    const nextClose = html.indexOf('</span>', j);
                    if (nextClose === -1) { j = html.length; break; }
                    if (nextOpen !== -1 && nextOpen < nextClose) {
                        depth++;
                        j = nextOpen + 5;
                    } else {
                        depth--;
                        j = nextClose + 7;
                    }
                }

                const spanContent = html.slice(spanStart, j);
                const annoMatch = spanContent.match(/<annotation[^>]*encoding="application\/x-tex"[^>]*>([\s\S]*?)<\/annotation>/);
                entries.push({
                    start: spanStart,
                    end: j,
                    id: nextId++,
                    html: spanContent,
                    latex: annoMatch?.[1]?.trim() ?? '',
                    isDisplay,
                });
                i = j;
            } else {
                i = tagEnd + 1;
            }
        }

        return entries;
    }

    private static _isSvgImageSource(src: string): boolean {
        return /^data:image\/svg\+xml(?:;charset=[^;,]+)?(?:;base64)?,/i.test(src)
            || /\.svg(?:[?#].*)?$/i.test(src)
            || /\.svg\+xml(?:[?#].*)?$/i.test(src);
    }

    private static _isDocxSafeImageSource(src: string): boolean {
        if (/^data:image\//i.test(src)) {
            return true;
        }
        if (/^https?:\/\//i.test(src)) {
            return true;
        }
        if (/^file:\/\//i.test(src)) {
            return /\.(png|jpe?g|gif|bmp|webp|svg)(?:[?#].*)?$/i.test(src);
        }
        return /\.(png|jpe?g|gif|bmp|webp|svg)(?:[?#].*)?$/i.test(src);
    }

    private static _replaceImgSrc(tag: string, newSrc: string): string {
        return tag.replace(/\bsrc=(["'])[^"']+\1/i, `src="${newSrc}"`);
    }

    private static _svgImageFallback(
        html: string,
        images: Array<{ start: number; end: number; alt: string }>
    ): string {
        let resolved = html;
        for (let i = images.length - 1; i >= 0; i--) {
            resolved = resolved.slice(0, images[i].start)
                + DocxExporter._svgImagePlaceholder(images[i].alt)
                + resolved.slice(images[i].end);
        }
        return resolved;
    }

    private static _normalizeDetails(html: string, settings?: PdfSettings): string {
        return html.replace(/<details[^>]*>([\s\S]*?)<\/details>/gi, (_match, inner) => {
            const summaryMatch = inner.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
            const summaryHtml = summaryMatch?.[1]?.trim() ?? 'Details';
            const body = summaryMatch ? inner.replace(summaryMatch[0], '') : inner;
            const font = DocxExporter._escapeHtmlAttr(DocxExporter._primaryFontFamily(settings?.bodyFont, 'Calibri'));
            return `<p style="font-family:${font};"><strong>${summaryHtml}</strong></p>${body}`;
        });
    }

    private static _normalizeAlerts(html: string, settings?: PdfSettings): string {
        const bodyFont = DocxExporter._escapeHtmlAttr(DocxExporter._primaryFontFamily(settings?.bodyFont, 'Calibri'));
        return html.replace(/<blockquote[^>]*class="[^"]*\bmarkdown-alert\b[^"]*"[^>]*>([\s\S]*?)<\/blockquote>/gi, (_match, inner) => {
            const titleMatch = inner.match(/<p[^>]*class="[^"]*\bmarkdown-alert-title\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
            const title = DocxExporter._stripTags(titleMatch?.[1] ?? 'Alert');
            const body = titleMatch ? inner.replace(titleMatch[0], '').trim() : inner.trim();
            return [
                '<table style="border-collapse:collapse;width:100%;margin:12px 0;">',
                '<tr>',
                `<td style="border:1px solid #d9dee8;padding:12px;font-family:${bodyFont};">`,
                `<p style="font-family:${bodyFont};margin:0 0 6px 0;"><strong>${DocxExporter._escapeHtmlText(title)}</strong></p>`,
                body,
                '</td>',
                '</tr>',
                '</table>',
            ].join('');
        });
    }

    private static _normalizeBlockquotes(html: string, settings?: PdfSettings): string {
        const bodyFont = DocxExporter._escapeHtmlAttr(DocxExporter._primaryFontFamily(settings?.bodyFont, 'Calibri'));
        return html.replace(/<blockquote(?![^>]*markdown-alert)([^>]*)>([\s\S]*?)<\/blockquote>/gi, (_match, _attrs, inner) => {
            return [
                '<table style="border-collapse:collapse;width:100%;margin:12px 0;">',
                '<tr>',
                `<td style="border:1px solid #d9dee8;padding:12px;font-family:${bodyFont};">`,
                inner.trim(),
                '</td>',
                '</tr>',
                '</table>',
            ].join('');
        });
    }

    private static _normalizeCodeBlocks(html: string): string {
        return html.replace(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_match, codeHtml) => {
            const plain = DocxExporter._decodeHtmlEntities(DocxExporter._stripTags(codeHtml));
            const lines = plain.split(/\r?\n/);
            const escapedLines = lines.map(line => DocxExporter._escapeHtmlText(line));
            const joined = escapedLines.join('<br>');
            return [
                '<table style="border-collapse:collapse;width:100%;margin:12px 0;">',
                '<tr>',
                '<td style="border:1px solid #d9dee8;padding:12px;font-family:Consolas, monospace;">',
                joined,
                '</td>',
                '</tr>',
                '</table>',
            ].join('');
        });
    }

    private static _normalizeInlineCode(html: string): string {
        return html.replace(/<code([^>]*)>([\s\S]*?)<\/code>/gi, (_match, _attrs, content) => {
            const text = DocxExporter._decodeHtmlEntities(DocxExporter._stripTags(content));
            return `<span style="font-family:Consolas, monospace;">${DocxExporter._escapeHtmlText(text)}</span>`;
        });
    }

    private static _normalizeMark(html: string): string {
        return html.replace(/<mark[^>]*>([\s\S]*?)<\/mark>/gi, (_match, content) => {
            return `<span style="background-color:#fff59d;">${content}</span>`;
        });
    }

    private static _applyDocxTypography(html: string, settings?: PdfSettings): string {
        const headingFont = DocxExporter._primaryFontFamily(settings?.headingFont, 'Georgia');
        const headingSizes = DocxExporter._headingSizeMap(settings?.headingSize);
        return html.replace(/<(h[1-6])([^>]*)>([\s\S]*?)<\/\1>/gi, (_match, tag, attrs, inner) => {
            const level = Number(tag.slice(1));
            const fontSize = level === 1
                ? headingSizes.h1
                : level === 2
                    ? headingSizes.h2
                    : headingSizes.h3;
            const cleanedAttrs = attrs?.trim() ? ` ${attrs.trim()}` : '';
            return `<${tag}${cleanedAttrs} style="font-family:${DocxExporter._escapeHtmlAttr(headingFont)};font-size:${fontSize};">${inner}</${tag}>`;
        });
    }

    private static _headingSizeMap(scale?: PdfSettings['headingSize']): { h1: string; h2: string; h3: string } {
        const map: Record<string, { h1: string; h2: string; h3: string }> = {
            S: { h1: '18pt', h2: '14pt', h3: '11pt' },
            M: { h1: '22pt', h2: '17pt', h3: '13pt' },
            L: { h1: '28pt', h2: '21pt', h3: '16pt' },
        };
        return map[scale || 'M'] ?? map.M;
    }

    private static _primaryFontFamily(fontSetting: string | undefined, fallback: string): string {
        if (!fontSetting) {
            return fallback;
        }

        const first = fontSetting.split(',')[0]?.trim();
        if (!first) {
            return fallback;
        }

        return first.replace(/^['"]|['"]$/g, '') || fallback;
    }

    private static _stripTags(value: string): string {
        return value.replace(/<[^>]+>/g, '');
    }

    private static _decodeHtmlEntities(value: string): string {
        return value
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, '\'')
            .replace(/&amp;/g, '&')
            .replace(/&nbsp;/g, ' ');
    }

    private static _svgImagePlaceholder(alt: string): string {
        return `<p><em>[Image: ${DocxExporter._escapeHtmlText(alt || 'image')}]</em></p>`;
    }

    private static _escapeHtmlAttr(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    private static _escapeHtmlText(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    private static _readTikzJaxFontCss(distDir: string): string {
        const cssPath = path.join(distDir, 'vendor', 'node-tikzjax', 'css', 'fonts.css');
        if (!fs.existsSync(cssPath)) {
            return '';
        }

        let css = fs.readFileSync(cssPath, 'utf-8');
        css = css.replace(/url\((['"]?)(bakoma\/ttf\/[^'")]+)\1\)/g, (_match, _quote, relativePath) => {
            const fontPath = path.join(path.dirname(cssPath), relativePath);
            if (!fs.existsSync(fontPath)) { return _match; }
            const b64 = fs.readFileSync(fontPath).toString('base64');
            return `url('data:font/ttf;base64,${b64}')`;
        });
        return css;
    }
}
