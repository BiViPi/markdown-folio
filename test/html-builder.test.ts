import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HtmlBuilder } from '../src/HtmlBuilder';

/**
 * Smoke tests for HtmlBuilder.buildExportHtml / buildPdfHtml.
 *
 * Coverage after Phase 3:
 *   - document-shape assertions for export and PDF templates
 *   - heading-font selector includes h2 (Phase 2 behavior fix)
 *   - CSP meta present on both templates (Phase 3 §3.2.5)
 *   - title escapes the full set `& < > " '` (Phase 3 §3.3)
 */
describe('HtmlBuilder', () => {
    // Use a fresh empty temp dir so neither dist/ nor webview/styles fallback
    // can pollute the output. _readDistOrSourceCss returns '' for missing files.
    let tmpDistDir: string;

    beforeAll(() => {
        tmpDistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-html-builder-test-'));
    });

    afterAll(() => {
        fs.rmSync(tmpDistDir, { recursive: true, force: true });
    });

    describe('buildExportHtml', () => {
        it('produces a full HTML document starting with <!DOCTYPE html>', () => {
            const out = HtmlBuilder.buildExportHtml({
                html: '<p>body</p>',
                distDir: tmpDistDir,
                title: 'Sample',
            });
            expect(out.trimStart().startsWith('<!DOCTYPE html>')).toBe(true);
        });

        it('contains exactly one <title> element with the supplied title', () => {
            const out = HtmlBuilder.buildExportHtml({
                html: '<p>body</p>',
                distDir: tmpDistDir,
                title: 'Sample',
            });
            const titleMatches = out.match(/<title>[^<]*<\/title>/g) ?? [];
            expect(titleMatches).toHaveLength(1);
            expect(titleMatches[0]).toContain('Sample');
        });

        it('wraps rendered html in #document-content under #document-paper', () => {
            const marker = '<p data-test-marker="true">body</p>';
            const out = HtmlBuilder.buildExportHtml({
                html: marker,
                distDir: tmpDistDir,
            });
            expect(out).toContain('id="document-paper"');
            expect(out).toContain('id="document-content"');
            expect(out).toContain(marker);
        });

        it('embeds the Mermaid CDN script tag (current behavior; HTML self-contained deferred to 1.6.0)', () => {
            const out = HtmlBuilder.buildExportHtml({
                html: '<p>body</p>',
                distDir: tmpDistDir,
            });
            expect(out).toContain('cdn.jsdelivr.net/npm/mermaid');
        });

        it('includes a Content-Security-Policy meta tag with the export baseline', () => {
            const out = HtmlBuilder.buildExportHtml({
                html: '<p>body</p>',
                distDir: tmpDistDir,
            });
            expect(out).toMatch(/<meta http-equiv="Content-Security-Policy"/);
            expect(out).toContain("default-src 'none'");
            expect(out).toContain('https://fonts.googleapis.com');
            expect(out).toContain('https://cdn.jsdelivr.net');
            expect(out).toContain("connect-src 'none'");
        });

        it('escapes the full set & < > " \' in title (Phase 3 §3.3)', () => {
            const out = HtmlBuilder.buildExportHtml({
                html: '<p>body</p>',
                distDir: tmpDistDir,
                title: `<X & "Y" 'Z'>`,
            });
            const m = out.match(/<title>([^<]*)<\/title>/);
            expect(m).not.toBeNull();
            const titleBody = m![1];
            // Every dangerous character must be escaped:
            expect(titleBody).not.toContain('<');
            expect(titleBody).not.toContain('>');
            expect(titleBody).not.toContain('"');
            expect(titleBody).not.toContain("'");
            // & is escaped to &amp; — assert no bare ampersand remains:
            expect(titleBody).not.toMatch(/&(?!(amp|lt|gt|quot|#39);)/);
            // And the entity for "&" itself is present:
            expect(titleBody).toContain('&amp;');
        });
    });

    describe('buildPdfHtml', () => {
        it('produces a full HTML document with a file:// base href to distDir', () => {
            const out = HtmlBuilder.buildPdfHtml({
                html: '<p>body</p>',
                distDir: tmpDistDir,
                title: 'Sample PDF',
            });
            expect(out.trimStart().startsWith('<!DOCTYPE html>')).toBe(true);
            expect(out).toContain('<base href="file:///');
        });

        it('includes a Content-Security-Policy meta tag with the PDF baseline', () => {
            const out = HtmlBuilder.buildPdfHtml({
                html: '<p>body</p>',
                distDir: tmpDistDir,
            });
            expect(out).toMatch(/<meta http-equiv="Content-Security-Policy"/);
            expect(out).toContain("default-src 'none'");
            expect(out).toContain('img-src data: file:');
            expect(out).toContain('script-src file:');
        });

        it('escapes the full set & < > " \' in title (Phase 3 §3.3)', () => {
            const out = HtmlBuilder.buildPdfHtml({
                html: '<p>body</p>',
                distDir: tmpDistDir,
                title: `<X & "Y" 'Z'>`,
            });
            const m = out.match(/<title>([^<]*)<\/title>/);
            expect(m).not.toBeNull();
            const titleBody = m![1];
            expect(titleBody).not.toContain('<');
            expect(titleBody).not.toContain('>');
            expect(titleBody).not.toContain('"');
            expect(titleBody).not.toContain("'");
            expect(titleBody).toContain('&amp;');
        });

        it('emits a heading-font override that targets all of h1-h6 (Phase 2 fix; h2 now included)', () => {
            const out = HtmlBuilder.buildPdfHtml({
                html: '<p>body</p>',
                distDir: tmpDistDir,
                settings: { headingFont: "'Georgia', serif" },
            });
            expect(out).toContain('h1, h2, h3, h4, h5, h6 { font-family:');
            // Guard against the previous-shape selector reappearing in this file.
            expect(out).not.toContain('h1, h3, h4, h5, h6 { font-family:');
        });
    });
});
