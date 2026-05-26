import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import puppeteer from 'puppeteer-core';
import { PdfExporter } from './PdfExporter';

export interface PngOptions {
    outputPath: string;
    mode: 'full' | 'pages';
    pageWidthPx?: number;
    pageHeightPx?: number;
    deviceScaleFactor?: number;
    chromePath?: string;
}

interface ScreenshotClip {
    x: number;
    y: number;
    width: number;
    height: number;
}

export class PngExporter {
    static async export(html: string, options: PngOptions): Promise<void> {
        const chromePath = PdfExporter.findChromePath(options.chromePath);

        const pageW = options.pageWidthPx ?? 1280;
        const pageH = options.pageHeightPx ?? 1600;
        const dsr = options.deviceScaleFactor ?? 2;

        const tmpFile = path.join(os.tmpdir(), `mf-png-${Date.now()}.html`);
        fs.writeFileSync(tmpFile, html, 'utf-8');

        const browser = await puppeteer.launch({
            executablePath: chromePath,
            headless: true,
        });

        try {
            const page = await browser.newPage();
            await page.setViewport({ width: pageW, height: pageH, deviceScaleFactor: dsr });
            await page.goto(`file:///${tmpFile.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0' });

            await page.waitForFunction(
                '!document.querySelector(".mermaid") || window._mermaidDone === true',
                { timeout: 15000 }
            );
            await PngExporter._waitForFonts(page);
            await PngExporter._preparePageForRasterExport(page);

            const paperMetrics = await PngExporter._getPaperMetrics(page);

            if (options.mode === 'full') {
                const buffer: Buffer = await page.screenshot({
                    type: 'png',
                    clip: paperMetrics.fullClip,
                    captureBeyondViewport: true,
                });
                fs.writeFileSync(options.outputPath, buffer);
            } else {
                if (!fs.existsSync(options.outputPath)) {
                    fs.mkdirSync(options.outputPath, { recursive: true });
                }
                const baseName = path.basename(options.outputPath);
                const pageCount = Math.ceil(paperMetrics.fullClip.height / paperMetrics.paperHeight);

                for (let i = 0; i < pageCount; i++) {
                    const y = paperMetrics.fullClip.y + i * paperMetrics.paperHeight;
                    const height = Math.min(
                        paperMetrics.paperHeight,
                        paperMetrics.fullClip.y + paperMetrics.fullClip.height - y
                    );
                    const buffer: Buffer = await page.screenshot({
                        type: 'png',
                        clip: {
                            x: paperMetrics.fullClip.x,
                            y,
                            width: paperMetrics.fullClip.width,
                            height,
                        },
                        captureBeyondViewport: true,
                    });
                    const fileName = `${baseName}-p${i + 1}.png`;
                    fs.writeFileSync(path.join(options.outputPath, fileName), buffer);
                }
            }
        } finally {
            await browser.close();
            fs.unlinkSync(tmpFile);
        }
    }

    private static async _getPaperMetrics(page: any): Promise<{
        fullClip: ScreenshotClip;
        paperHeight: number;
    }> {
        return page.evaluate(() => {
            const paper = document.getElementById('document-paper');
            if (!paper) {
                const width = document.documentElement.scrollWidth;
                const height = document.documentElement.scrollHeight;
                return {
                    fullClip: { x: 0, y: 0, width, height },
                    paperHeight: height,
                };
            }

            const rect = paper.getBoundingClientRect();
            const scrollX = window.scrollX || document.documentElement.scrollLeft;
            const scrollY = window.scrollY || document.documentElement.scrollTop;
            const style = window.getComputedStyle(paper);
            const marginBottom = parseFloat(style.marginBottom) || 0;
            const fullHeight = Math.max(
                paper.scrollHeight,
                paper.clientHeight,
                paper.getBoundingClientRect().height
            );
            const fullWidth = Math.max(
                paper.scrollWidth,
                paper.clientWidth,
                paper.getBoundingClientRect().width
            );

            return {
                fullClip: {
                    x: Math.max(0, Math.floor(rect.left + scrollX)),
                    y: Math.max(0, Math.floor(rect.top + scrollY)),
                    width: Math.ceil(fullWidth),
                    height: Math.ceil(fullHeight + marginBottom),
                },
                paperHeight: Math.ceil(rect.width * 297 / 210),
            };
        });
    }

    private static async _waitForFonts(page: any): Promise<void> {
        try {
            await page.evaluate(async () => {
                if ('fonts' in document) {
                    await (document as Document & { fonts: { ready: Promise<unknown> } }).fonts.ready;
                }
            });
        } catch {
            // Font readiness is a quality improvement, not a hard requirement.
        }
    }

    private static async _preparePageForRasterExport(page: any): Promise<void> {
        await page.addStyleTag({
            content: `
html, body {
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
}
.workspace-shell {
    display: block !important;
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
}
#document-container {
    display: block !important;
    height: auto !important;
    min-height: 0 !important;
    overflow: visible !important;
}
#document-paper {
    transform: none !important;
    margin-bottom: 0 !important;
    overflow: visible !important;
}
`
        });

        await page.evaluate(async () => {
            window.scrollTo(0, 0);
            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        });
    }
}
