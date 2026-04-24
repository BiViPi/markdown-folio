import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import HTMLtoDOCX from 'html-to-docx';
import JSZip from 'jszip';
import katex from 'katex';
import puppeteer from 'puppeteer-core';
import { PdfExporter } from './PdfExporter';
import { PdfSettings } from './HtmlBuilder';
import { MathMlToOmml } from './MathMlToOmml';

export interface DocxOptions {
    outputPath: string;
    title?: string;
    distDir: string;
    settings?: PdfSettings;
}

type OmmlMap = Map<number, { omml: string; isDisplay: boolean }>;

export class DocxExporter {
    static async export(html: string, options: DocxOptions): Promise<void> {

        const { processed, ommlMap } = await DocxExporter._preprocess(html, options.distDir);

        const rawBuffer: Buffer = await HTMLtoDOCX(processed, undefined, {
            title: options.title || 'Document',
            font: 'Calibri',
            fontSize: 22, // 11pt in half-points (OOXML unit)
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
     * 6. OMML formula injection (replacing OMML_MARKER_N placeholders)
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

        // Fix 6: Inject OMML formulas (replace OMML_MARKER_N placeholders)
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
     * 1. Mermaid code blocks → PNG images via Puppeteer
     * 2. KaTeX HTML → OMML marker placeholders (synchronous, no Puppeteer)
     */
    private static async _preprocess(html: string, distDir: string): Promise<{ processed: string; ommlMap: OmmlMap }> {
        let processed = html;
        processed = await DocxExporter.replaceMermaidWithImages(processed, distDir);
        const { processed: withMarkers, ommlMap } = DocxExporter._replaceKatexWithOmml(processed);
        return { processed: withMarkers, ommlMap };
    }

    /**
     * Replace KaTeX HTML spans with OMML placeholder markers.
     * Converts LaTeX → MathML (KaTeX) → OMML (MathMlToOmml) synchronously.
     * No browser required.
     */
    private static _replaceKatexWithOmml(html: string): { processed: string; ommlMap: OmmlMap } {
        const ommlMap: OmmlMap = new Map();
        const entries: { start: number; end: number; id: number; omml: string; isDisplay: boolean }[] = [];
        let nextId = 0;
        let i = 0;

        while (i < html.length) {
            const spanStart = html.indexOf('<span', i);
            if (spanStart === -1) { break; }
            const tagEnd = html.indexOf('>', spanStart);
            if (tagEnd === -1) { break; }
            const openTag = html.slice(spanStart, tagEnd + 1);

            // Match only outermost <span class="katex"> or <span class="katex-display">
            // Skip sub-spans like katex-html, katex-mathml
            if (/class="[^"]*\bkatex\b/.test(openTag) &&
                !/class="[^"]*katex-html/.test(openTag) &&
                !/class="[^"]*katex-mathml/.test(openTag)) {

                const isDisplay = /class="[^"]*katex-display/.test(openTag);

                // Find balanced closing </span>
                let depth = 1, j = tagEnd + 1;
                while (j < html.length && depth > 0) {
                    const nextOpen = html.indexOf('<span', j);
                    const nextClose = html.indexOf('</span>', j);
                    if (nextClose === -1) { j = html.length; break; }
                    if (nextOpen !== -1 && nextOpen < nextClose) { depth++; j = nextOpen + 5; }
                    else { depth--; j = nextClose + 7; }
                }

                const spanContent = html.slice(spanStart, j);
                const annoMatch = spanContent.match(/<annotation[^>]*encoding="application\/x-tex"[^>]*>([\s\S]*?)<\/annotation>/);

                if (annoMatch) {
                    const latex = annoMatch[1].trim();
                    let omml = '';
                    try {
                        const mmlResult = katex.renderToString(latex, { output: 'mathml', throwOnError: false });
                        omml = MathMlToOmml.convert(mmlResult);
                    } catch {
                        // omml stays empty — marker injection will be skipped
                    }
                    const id = nextId++;
                    entries.push({ start: spanStart, end: j, id, omml, isDisplay });
                    ommlMap.set(id, { omml, isDisplay });
                }
                i = j;
            } else {
                i = tagEnd + 1;
            }
        }

        if (entries.length === 0) { return { processed: html, ommlMap }; }

        // Replace from end to preserve string indices
        let processed = html;
        for (let k = entries.length - 1; k >= 0; k--) {
            const { start, end, id, isDisplay } = entries[k];
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
     * Render each Mermaid diagram to PNG via Puppeteer, replace code block with <img>.
     * Falls back to text placeholder if Chrome is not available.
     */
    static async replaceMermaidWithImages(html: string, distDir: string): Promise<string> {
        const sources = DocxExporter._extractMermaidSources(html);
        if (sources.length === 0) { return html; }

        let chromePath: string;
        try {
            chromePath = PdfExporter.findChromePath();
        } catch {
            return DocxExporter._mermaidFallback(html);
        }

        const mermaidJs = path.join(distDir, 'mermaid.min.js').replace(/\\/g, '/');
        const browser = await puppeteer.launch({
            executablePath: chromePath,
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });

        const images: (string | null)[] = [];
        try {
            for (const source of sources) {
                const pageHtml = `<!DOCTYPE html><html><head><style>
                    body { margin: 0; padding: 8px; background: white; }
                    .mermaid { display: inline-block; }
                    .mermaid svg { display: block; max-width: 100%; height: auto; }
                </style></head><body>
                    <div class="mermaid">${source}</div>
                    <script src="file:///${mermaidJs}"><\/script>
                    <script>
                        window._done = false;
                        mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
                        mermaid.run({ querySelector: '.mermaid' })
                            .then(function() { window._done = true; })
                            .catch(function() { window._done = true; });
                    <\/script>
                </body></html>`;

                const tmpFile = path.join(os.tmpdir(), `mf-mermaid-${Date.now()}.html`);
                fs.writeFileSync(tmpFile, pageHtml, 'utf-8');

                const page = await browser.newPage();
                await page.setViewport({ width: 900, height: 600 });
                await page.goto(`file:///${tmpFile.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0' });
                await page.waitForFunction('window._done === true', { timeout: 15000 });

                const svgEl = await page.$('.mermaid svg');
                const captureEl = svgEl ?? await page.$('.mermaid');
                const bbox = captureEl ? await captureEl.boundingBox() : null;
                if (bbox && bbox.width > 0 && bbox.height > 0) {
                    const buf = await page.screenshot({
                        type: 'png',
                        clip: {
                            x: Math.max(0, bbox.x),
                            y: Math.max(0, bbox.y),
                            width: Math.ceil(bbox.width),
                            height: Math.ceil(bbox.height),
                        },
                    });
                    images.push(`data:image/png;base64,${Buffer.from(buf).toString('base64')}`);
                } else {
                    images.push(null);
                }

                await page.close();
                fs.unlinkSync(tmpFile);
            }
        } finally {
            await browser.close();
        }

        let idx = 0;
        return html.replace(
            DocxExporter._mermaidBlockRegex(),
            (_match, content) => {
                const imgSrc = images[idx++];
                if (imgSrc) {
                    return `<img src="${imgSrc}" style="max-width:100%;display:block;margin:8px 0;">`;
                }
                const firstLine = content.trim().split('\n')[0] || 'diagram';
                return `<p><em>[Diagram: ${firstLine}]</em></p>`;
            }
        );
    }

    private static _mermaidFallback(html: string): string {
        return html.replace(
            DocxExporter._mermaidBlockRegex(),
            (_match, content) => {
                const firstLine = content.trim().split('\n')[0] || 'diagram';
                return `<p><em>[Diagram: ${firstLine}]</em></p>`;
            }
        );
    }

    private static _mermaidBlockRegex(): RegExp {
        return /(?:<pre[^>]*>\s*<code[^>]*class="[^"]*language-mermaid[^"]*"[^>]*>([\s\S]*?)<\/code>\s*<\/pre>)|(?:<div[^>]*class="[^"]*\bmermaid\b[^"]*"[^>]*>([\s\S]*?)<\/div>)/g;
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
}
