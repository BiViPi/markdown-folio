import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MarkdownEngine } from '../src/engine/MarkdownEngine';
import { sanitizeRenderedHtml } from '../src/engine/sanitizer';
import { HtmlBuilder } from '../src/HtmlBuilder';

/**
 * Phase 3 security integration smoke (plan 03-regression §3.2).
 *
 * Runs the full pipeline that any export takes:
 *   markdown source → MarkdownEngine.render → sanitizeRenderedHtml → HtmlBuilder.
 *
 * This is the actual release safety net for Phase 3. The unit-level sanitizer
 * tests in test/sanitizer.test.ts assert pieces of the contract; this file
 * asserts that the pieces compose into a safe export string.
 */

const HOSTILE_MARKDOWN = [
    '# Title',
    '',
    '<script>document.title = "XSS-test"</script>',
    '',
    '<iframe src="https://attacker.example/x"></iframe>',
    '',
    '<img src="x" onerror="alert(1)" alt="trap">',
    '',
    '<a href="javascript:alert(1)">click</a>',
    '',
    'Inline KaTeX: $x^2 + y^2 = z^2$.',
    '',
    '```mermaid',
    'flowchart TD',
    'A --> B',
    '```',
    '',
    '```tikz',
    '\\draw (0,0) -- (1,1);',
    '```',
    '',
    'End of document.',
].join('\n') + '\n';

describe('security integration — render → sanitize → buildExportHtml', () => {
    let tmpDistDir: string;
    let finalHtml: string;

    beforeAll(() => {
        tmpDistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-security-integration-'));
        const engine = new MarkdownEngine();
        const rawHtml = engine.render(HOSTILE_MARKDOWN);
        const sanitized = sanitizeRenderedHtml(rawHtml);
        finalHtml = HtmlBuilder.buildExportHtml({
            html: sanitized,
            distDir: tmpDistDir,
            title: 'Integration test',
        });
    });

    afterAll(() => {
        fs.rmSync(tmpDistDir, { recursive: true, force: true });
    });

    it('does not leak a <script> tag into the export HTML body', () => {
        // The export template itself contains an inline Mermaid initializer
        // <script> tag — that is expected. We must NOT contain the attacker's
        // <script> from the markdown source. We test by asserting the attacker
        // payload string is absent end-to-end.
        expect(finalHtml).not.toContain('document.title = "XSS-test"');
        expect(finalHtml).not.toContain('XSS-test');
    });

    it('does not leak the onerror handler attribute', () => {
        expect(finalHtml).not.toContain('onerror=');
    });

    it('does not leak a javascript: URI', () => {
        expect(finalHtml).not.toContain('javascript:');
    });

    it('does not leak an <iframe>', () => {
        expect(finalHtml).not.toContain('<iframe');
    });

    it('contains a Content-Security-Policy meta tag', () => {
        expect(finalHtml).toMatch(/<meta http-equiv="Content-Security-Policy"/);
        expect(finalHtml).toContain("default-src 'none'");
    });

    it('preserves the KaTeX render output', () => {
        expect(finalHtml).toContain('class="katex"');
    });

    it('preserves the Mermaid fenced-code placeholder', () => {
        expect(finalHtml).toContain('class="language-mermaid"');
        expect(finalHtml).toContain('flowchart TD');
    });

    it('preserves the TikZ-pending placeholder with data-tikz', () => {
        expect(finalHtml).toContain('class="tikz-pending"');
        expect(finalHtml).toMatch(/data-tikz="[A-Za-z0-9_-]+"/);
    });

    it('preserves data-source-line attributes for scroll sync', () => {
        expect(finalHtml).toMatch(/data-source-line="\d+"/);
    });
});
