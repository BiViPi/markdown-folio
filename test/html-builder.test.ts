import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HtmlBuilder } from '../src/HtmlBuilder';

/**
 * Smoke tests for HtmlBuilder.buildExportHtml / buildPdfHtml.
 *
 * Current coverage after Phase 2:
 *   - document-shape assertions for export and PDF templates
 *   - heading-font selector includes h2 (Phase 2 behavior fix)
 *
 * Still deferred to Phase 3:
 *   - CSP meta assertions
 *   - tightened title escaping for `& > " '`
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

        it('escapes "<" in title (Phase 1 partial-escape behavior; full escape lands later)', () => {
            const out = HtmlBuilder.buildExportHtml({
                html: '<p>body</p>',
                distDir: tmpDistDir,
                title: '<script>X</script>',
            });
            // Find the <title>...</title> body
            const m = out.match(/<title>([^<]*)<\/title>/);
            expect(m).not.toBeNull();
            const titleBody = m![1];
            // '<' currently escaped to &lt;; the closing-tag '<' too. Other chars pass through.
            expect(titleBody).not.toContain('<');
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
