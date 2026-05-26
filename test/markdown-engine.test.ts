import { describe, it, expect } from 'vitest';
import { MarkdownEngine } from '../src/engine/MarkdownEngine';

/**
 * Phase 1 smoke tests for MarkdownEngine.render — guards the basic render
 * shapes that every export path depends on. These assertions are intentionally
 * shape-only; deeper assertions (e.g. sanitizer behavior) are added in Phase 3.
 */
describe('MarkdownEngine.render', () => {
    const engine = new MarkdownEngine();

    it('renders ATX heading to <h1>', () => {
        const html = engine.render('# Hello world');
        expect(html).toContain('<h1');
        expect(html).toContain('Hello world');
    });

    it('renders mermaid fenced block to a language-mermaid code block', () => {
        const html = engine.render('```mermaid\nflowchart TD\nA-->B\n```\n');
        expect(html).toContain('<code class="language-mermaid">');
    });

    it('renders tikz fenced block to a tikz-pending placeholder with data-tikz', () => {
        const html = engine.render('```tikz\n\\draw (0,0) -- (1,1);\n```\n');
        expect(html).toContain('class="tikz-pending"');
        expect(html).toMatch(/data-tikz="[A-Za-z0-9_-]+"/);
    });

    it('renders inline KaTeX math to an element with class "katex"', () => {
        const html = engine.render('Inline math $x^2$ here.\n');
        expect(html).toContain('class="katex"');
    });

    it('emits data-source-line on block tokens after frontmatter offset', () => {
        const html = engine.render('# Heading\n\nBody paragraph.\n', 3);
        expect(html).toMatch(/data-source-line="\d+"/);
    });

    it('preserves raw HTML img tags with data URI sources', () => {
        const html = engine.render('<img alt="Tiny data URI" src="data:image/svg+xml;base64,PHN2Zy8+">');
        expect(html).toContain('<img alt="Tiny data URI" src="data:image/svg+xml;base64,PHN2Zy8+">');
    });
});
