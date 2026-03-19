import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface PdfOptions {
    orientation: 'portrait' | 'landscape';
    size: 'A4' | 'A3' | 'Letter';
    outputPath: string;
    headings?: { text: string; level: number }[];
}

interface HeadingPosition {
    text: string;
    level: number;
    top: number;   // px from document top
}

export class PdfExporter {
    /**
     * Tìm Chrome/Chromium executable path từ các vị trí phổ biến.
     */
    static findChromePath(): string {
        const candidates: string[] = [];
        const platform = process.platform;

        if (platform === 'win32') {
            const programFiles = process.env['PROGRAMFILES'] || 'C:\\Program Files';
            const programFilesX86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
            candidates.push(
                path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
                path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
                path.join(programFiles, 'Google', 'Chrome Beta', 'Application', 'chrome.exe'),
                path.join(process.env['LOCALAPPDATA'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
            );
        } else if (platform === 'darwin') {
            candidates.push(
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
                '/Applications/Chromium.app/Contents/MacOS/Chromium',
            );
        } else {
            candidates.push(
                '/usr/bin/google-chrome',
                '/usr/bin/google-chrome-stable',
                '/usr/bin/chromium-browser',
                '/usr/bin/chromium',
            );
        }

        for (const candidate of candidates) {
            if (candidate && fs.existsSync(candidate)) {
                return candidate;
            }
        }

        throw new Error(
            'Chrome không tìm thấy. Hãy cài Google Chrome hoặc cấu hình đường dẫn trong settings.'
        );
    }

    static async export(html: string, options: PdfOptions): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const puppeteer = require('puppeteer-core');
        const chromePath = PdfExporter.findChromePath();

        const tmpFile = path.join(os.tmpdir(), `mf-export-${Date.now()}.html`);
        fs.writeFileSync(tmpFile, html, 'utf-8');

        const browser = await puppeteer.launch({
            executablePath: chromePath,
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });

        try {
            const page = await browser.newPage();
            await page.goto(`file:///${tmpFile.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0' });

            await page.waitForFunction(
                '!document.querySelector(".mermaid") || window._mermaidDone === true',
                { timeout: 15000 }
            );

            const paperSizeMap: Record<string, { width: string; height: string; widthMm: number; heightMm: number }> = {
                'A4': { width: '210mm', height: '297mm', widthMm: 210, heightMm: 297 },
                'A3': { width: '297mm', height: '420mm', widthMm: 297, heightMm: 420 },
                'Letter': { width: '216mm', height: '279mm', widthMm: 216, heightMm: 279 },
            };

            const paper = paperSizeMap[options.size] || paperSizeMap['A4'];
            const isLandscape = options.orientation === 'landscape';

            const pageWidthMm = isLandscape ? paper.heightMm : paper.widthMm;
            const pageHeightMm = isLandscape ? paper.widthMm : paper.heightMm;

            // Collect heading positions before pdf() — needed for bookmark coordinate mapping
            let headingPositions: HeadingPosition[] = [];
            if (options.headings && options.headings.length > 0) {
                headingPositions = await page.evaluate(() => {
                    const results: HeadingPosition[] = [];
                    document.querySelectorAll('h1, h2, h3').forEach((el: Element) => {
                        const level = parseInt(el.tagName.charAt(1), 10);
                        const rect = el.getBoundingClientRect();
                        const scrollTop = window.scrollY || document.documentElement.scrollTop;
                        results.push({
                            text: (el as HTMLElement).innerText.trim(),
                            level,
                            top: rect.top + scrollTop,
                        });
                    });
                    return results;
                }) as HeadingPosition[];
            }

            const pdfBuffer: Buffer = await page.pdf({
                width: isLandscape ? paper.height : paper.width,
                height: isLandscape ? paper.width : paper.height,
                printBackground: true,
                margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
            });

            if (headingPositions.length > 0) {
                const withBookmarks = await PdfExporter._addBookmarks(
                    pdfBuffer,
                    headingPositions,
                    pageWidthMm,
                    pageHeightMm
                );
                fs.writeFileSync(options.outputPath, withBookmarks);
            } else {
                fs.writeFileSync(options.outputPath, pdfBuffer);
            }
        } finally {
            await browser.close();
            fs.unlinkSync(tmpFile);
        }
    }

    private static async _addBookmarks(
        pdfBytes: Buffer,
        headings: HeadingPosition[],
        pageWidthMm: number,
        pageHeightMm: number
    ): Promise<Uint8Array> {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { PDFDocument, PDFName, PDFDict, PDFRef, PDFNumber, PDFArray, PDFString } = require('pdf-lib');

        const pdfDoc = await PDFDocument.load(pdfBytes);
        const pages = pdfDoc.getPages();

        const PX_PER_MM = 96 / 25.4;
        const pageHeightPx = pageHeightMm * PX_PER_MM;
        // PDF uses 72 pts per inch; 1mm = 72/25.4 pts
        const MM_TO_PT = 72 / 25.4;
        const pageHeightPt = pageHeightMm * MM_TO_PT;
        const marginTopPt = 15 * MM_TO_PT;

        // Map each heading to a page index + Y coordinate (PDF bottom-origin, pts)
        const mapped = headings.map(h => {
            const pageIndex = Math.min(Math.floor(h.top / pageHeightPx), pages.length - 1);
            const yInPagePx = h.top - pageIndex * pageHeightPx;
            const yPt = pageHeightPt - yInPagePx * (pageHeightPt / pageHeightPx) - marginTopPt;
            return { ...h, pageIndex, yPt: Math.max(0, yPt) };
        });

        // Build PDF outline dict tree
        const context = pdfDoc.context;
        const catalog = pdfDoc.catalog;

        // Helper: create outline item dict
        const makeItem = (text: string, pageIndex: number, yPt: number): PDFRef => {
            const page = pages[pageIndex];
            const dest = PDFArray.withContext(context);
            dest.push(page.ref);
            dest.push(PDFName.of('XYZ'));
            dest.push(PDFNumber.of(0));
            dest.push(PDFNumber.of(yPt));
            dest.push(PDFNumber.of(0));

            const dict = PDFDict.withContext(context);
            dict.set(PDFName.of('Title'), PDFString.of(text));
            dict.set(PDFName.of('Dest'), dest);
            return context.register(dict);
        };

        // Build tree: H1 → root items, H2 → children of last H1, H3 → children of last H2
        interface OutlineNode {
            ref: PDFRef;
            dict: any;
            children: OutlineNode[];
            level: number;
        }

        const roots: OutlineNode[] = [];
        let lastH1: OutlineNode | null = null;
        let lastH2: OutlineNode | null = null;

        for (const h of mapped) {
            const ref = makeItem(h.text, h.pageIndex, h.yPt);
            const dict = context.lookup(ref) as PDFDict;
            const node: OutlineNode = { ref, dict, children: [], level: h.level };

            if (h.level === 1) {
                roots.push(node);
                lastH1 = node;
                lastH2 = null;
            } else if (h.level === 2) {
                if (lastH1) { lastH1.children.push(node); } else { roots.push(node); }
                lastH2 = node;
            } else {
                if (lastH2) { lastH2.children.push(node); }
                else if (lastH1) { lastH1.children.push(node); }
                else { roots.push(node); }
            }
        }

        // Wire up prev/next/parent/count links
        const wireNodes = (nodes: OutlineNode[], parentRef: PDFRef | null) => {
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                if (parentRef) { node.dict.set(PDFName.of('Parent'), parentRef); }
                if (i > 0) { node.dict.set(PDFName.of('Prev'), nodes[i - 1].ref); }
                if (i < nodes.length - 1) { node.dict.set(PDFName.of('Next'), nodes[i + 1].ref); }
                if (node.children.length > 0) {
                    const firstChild = node.children[0].ref;
                    const lastChild = node.children[node.children.length - 1].ref;
                    node.dict.set(PDFName.of('First'), firstChild);
                    node.dict.set(PDFName.of('Last'), lastChild);
                    node.dict.set(PDFName.of('Count'), PDFNumber.of(node.children.length));
                    wireNodes(node.children, node.ref);
                }
            }
        };

        if (roots.length === 0) {
            return pdfDoc.save();
        }

        // Create Outlines dict
        const outlineDict = PDFDict.withContext(context);
        const outlineRef = context.register(outlineDict);

        wireNodes(roots, outlineRef);

        outlineDict.set(PDFName.of('Type'), PDFName.of('Outlines'));
        outlineDict.set(PDFName.of('First'), roots[0].ref);
        outlineDict.set(PDFName.of('Last'), roots[roots.length - 1].ref);
        outlineDict.set(PDFName.of('Count'), PDFNumber.of(roots.length));

        // Set root Parent for all root nodes
        for (const node of roots) {
            node.dict.set(PDFName.of('Parent'), outlineRef);
        }

        catalog.set(PDFName.of('Outlines'), outlineRef);
        catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));

        return pdfDoc.save();
    }
}
