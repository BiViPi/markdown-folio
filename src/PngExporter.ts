import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { PdfExporter } from './PdfExporter';

export interface PngOptions {
    outputPath: string;
    mode: 'full' | 'pages';
    pageWidthPx?: number;   // default 794 (A4 at 96dpi)
    pageHeightPx?: number;  // default 1123 (A4 at 96dpi)
    deviceScaleFactor?: number; // default 2 (Retina quality)
}

export class PngExporter {
    static async export(html: string, options: PngOptions): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const puppeteer = require('puppeteer-core');
        const chromePath = PdfExporter.findChromePath();

        const pageW = options.pageWidthPx ?? 794;
        const pageH = options.pageHeightPx ?? 1123;
        const dsr = options.deviceScaleFactor ?? 2;

        const tmpFile = path.join(os.tmpdir(), `mf-png-${Date.now()}.html`);
        fs.writeFileSync(tmpFile, html, 'utf-8');

        const browser = await puppeteer.launch({
            executablePath: chromePath,
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });

        try {
            const page = await browser.newPage();
            await page.setViewport({ width: pageW, height: pageH, deviceScaleFactor: dsr });
            await page.goto(`file:///${tmpFile.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0' });

            await page.waitForFunction(
                '!document.querySelector(".mermaid") || window._mermaidDone === true',
                { timeout: 15000 }
            );

            if (options.mode === 'full') {
                const buffer: Buffer = await page.screenshot({ type: 'png', fullPage: true });
                fs.writeFileSync(options.outputPath, buffer);
            } else {
                // Pages mode: screenshot từng "trang" theo chiều cao viewport
                const totalHeight: number = await page.evaluate(
                    () => document.documentElement.scrollHeight
                );
                const pageCount = Math.ceil(totalHeight / pageH);

                // outputPath là folder path cho pages mode
                if (!fs.existsSync(options.outputPath)) {
                    fs.mkdirSync(options.outputPath, { recursive: true });
                }
                const baseName = path.basename(options.outputPath);

                for (let i = 0; i < pageCount; i++) {
                    const buffer: Buffer = await page.screenshot({
                        type: 'png',
                        clip: { x: 0, y: i * pageH, width: pageW, height: pageH },
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
}
