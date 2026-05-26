import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import puppeteer, { type Browser } from 'puppeteer-core';

/**
 * A single rasterization job.
 * The caller provides fully-formed HTML. BrowserRasterizer handles the
 * Puppeteer lifecycle and returns a PNG data URL.
 */
export interface RasterizeJob {
    /** Full HTML document string to load in the page. */
    html: string;
    /** CSS selector of the element to screenshot. Falls back to 'body' if not found. */
    selector: string;
    /** Optional JS expression evaluated in the page context before screenshot. */
    waitCondition?: string;
    /** Per-job timeout for waitCondition, default 15 000 ms. */
    timeout?: number;
}

export interface RasterizeOptions {
    pageWidth?: number;    // viewport width, default 900
    pageHeight?: number;   // viewport height, default 600
    scaleFactor?: number;  // deviceScaleFactor, default 2
}

export class BrowserRasterizer {
    /**
     * Rasterize one or more HTML snippets to PNG data URLs using a single
     * shared browser instance. Jobs are processed serially.
     *
     * Returns null for a job that produces no visible output or throws.
     * The returned array length always equals jobs.length.
     */
    static async renderAll(
        chromePath: string,
        jobs: RasterizeJob[],
        options?: RasterizeOptions
    ): Promise<Array<string | null>> {
        if (jobs.length === 0) { return []; }

        const pageWidth = options?.pageWidth ?? 900;
        const pageHeight = options?.pageHeight ?? 600;
        const scaleFactor = options?.scaleFactor ?? 2;

        const browser = await puppeteer.launch({
            executablePath: chromePath,
            headless: true,
        });

        const results: Array<string | null> = [];

        try {
            for (const job of jobs) {
                const result = await BrowserRasterizer._renderJob(
                    browser, job, pageWidth, pageHeight, scaleFactor
                );
                results.push(result);
            }
        } finally {
            await browser.close();
        }

        return results;
    }

    private static async _renderJob(
        browser: Browser,
        job: RasterizeJob,
        pageWidth: number,
        pageHeight: number,
        scaleFactor: number
    ): Promise<string | null> {
        const tmpFile = path.join(
            os.tmpdir(),
            `mf-raster-${Date.now()}-${Math.random().toString(36).slice(2)}.html`
        );
        fs.writeFileSync(tmpFile, job.html, 'utf-8');

        const page = await browser.newPage();
        try {
            await page.setViewport({ width: pageWidth, height: pageHeight, deviceScaleFactor: scaleFactor });
            await page.goto(pathToFileURL(tmpFile).href, { waitUntil: 'networkidle0' });

            if (job.waitCondition) {
                await page.waitForFunction(job.waitCondition, { timeout: job.timeout ?? 15_000 });
            }

            // Try the specified selector; fall back to body.
            const el = await page.$(job.selector) ?? await page.$('body');
            const bbox = el ? await el.boundingBox() : null;

            if (!bbox || bbox.width === 0 || bbox.height === 0) {
                return null;
            }

            const buf = await page.screenshot({
                type: 'png',
                clip: {
                    x: Math.max(0, bbox.x),
                    y: Math.max(0, bbox.y),
                    width: Math.ceil(bbox.width),
                    height: Math.ceil(bbox.height),
                },
            });

            return `data:image/png;base64,${Buffer.from(buf).toString('base64')}`;

        } catch {
            return null;
        } finally {
            await page.close();
            try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
        }
    }
}
