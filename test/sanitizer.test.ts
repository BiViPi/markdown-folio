import { describe, it, expect } from 'vitest';
import { sanitizeRenderedHtml } from '../src/engine/sanitizer';

/**
 * Phase 3 sanitizer smoke tests.
 *
 * Three contracts (per 02-security-hardening §3.2.4):
 *   - Strip: script/iframe/object/embed/form, on* attributes, javascript: URIs
 *   - Preserve: KaTeX shape, Mermaid placeholder, TikZ placeholder, header
 *     anchor, data-source-line + project data attributes
 *   - Idempotence: sanitize(sanitize(x)) === sanitize(x)
 */

describe('sanitizeRenderedHtml — strip', () => {
    it('removes <script> elements entirely', () => {
        const input = '<p>before</p><script>alert(1)</script><p>after</p>';
        const out = sanitizeRenderedHtml(input);
        expect(out).not.toContain('<script');
        expect(out).not.toContain('alert(1)');
        expect(out).toContain('before');
        expect(out).toContain('after');
    });

    it('removes inline event handlers but keeps the element', () => {
        const input = '<img src="x" onerror="alert(1)" alt="logo">';
        const out = sanitizeRenderedHtml(input);
        expect(out).not.toContain('onerror');
        expect(out).not.toContain('alert(1)');
        expect(out).toContain('<img');
        expect(out).toContain('alt="logo"');
    });

    it('neutralizes javascript: URIs on links', () => {
        const input = '<a href="javascript:alert(1)">click</a>';
        const out = sanitizeRenderedHtml(input);
        expect(out).not.toContain('javascript:');
        expect(out).toContain('click');
    });

    it('removes <iframe> elements', () => {
        const input = '<iframe src="https://attacker.example/x"></iframe>';
        const out = sanitizeRenderedHtml(input);
        expect(out).not.toContain('<iframe');
    });

    it('removes <object> and <embed> elements', () => {
        const input = '<object data="x"></object><embed src="y">';
        const out = sanitizeRenderedHtml(input);
        expect(out).not.toContain('<object');
        expect(out).not.toContain('<embed');
    });

    it('removes <form> elements (FORBID_TAGS)', () => {
        const input = '<form action="/x"><input name="q"></form>';
        const out = sanitizeRenderedHtml(input);
        expect(out).not.toContain('<form');
    });

    it('removes <base> elements (FORBID_TAGS — export template owns <base>)', () => {
        const input = '<base href="https://attacker.example/"><p>body</p>';
        const out = sanitizeRenderedHtml(input);
        expect(out).not.toContain('<base');
        expect(out).toContain('<p>body</p>');
    });
});

describe('sanitizeRenderedHtml — preserve', () => {
    it('preserves the Mermaid fenced-code placeholder', () => {
        const input = '<pre data-source-line="3"><code class="language-mermaid">flowchart TD\nA-->B</code></pre>';
        const out = sanitizeRenderedHtml(input);
        expect(out).toContain('class="language-mermaid"');
        expect(out).toContain('data-source-line="3"');
        expect(out).toContain('flowchart TD');
    });

    it('preserves the TikZ-pending placeholder with data-tikz', () => {
        const input = '<div class="tikz-pending" data-tikz="abc123" data-source-line="5"></div>';
        const out = sanitizeRenderedHtml(input);
        expect(out).toContain('class="tikz-pending"');
        expect(out).toContain('data-tikz="abc123"');
        expect(out).toContain('data-source-line="5"');
    });

    it('preserves a resolved TikZ inline SVG block', () => {
        const input = '<div class="tikz-rendered" data-source-line="7"><svg viewBox="0 0 10 10"><path d="M0 0L10 10" stroke="black"/></svg></div>';
        const out = sanitizeRenderedHtml(input);
        expect(out).toContain('class="tikz-rendered"');
        expect(out).toContain('<svg');
        expect(out).toContain('<path');
        expect(out).toContain('data-source-line="7"');
    });

    it('preserves the header anchor link with inline SVG', () => {
        const input = '<h1><a href="#slug" class="header-anchor"><svg class="header-anchor-icon" viewBox="0 0 24 24"><path d="M10 13"/></svg></a>Title</h1>';
        const out = sanitizeRenderedHtml(input);
        expect(out).toContain('<a');
        expect(out).toContain('href="#slug"');
        expect(out).toContain('class="header-anchor"');
        expect(out).toContain('class="header-anchor-icon"');
    });

    it('preserves KaTeX-shaped output (span + class="katex")', () => {
        const input = '<p>inline <span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math></span></span> here</p>';
        const out = sanitizeRenderedHtml(input);
        expect(out).toContain('class="katex"');
        expect(out).toContain('class="katex-mathml"');
        expect(out).toContain('<math');
        expect(out).toContain('<mi');
    });

    it('preserves data: image URIs on <img> elements', () => {
        const input = '<img src="data:image/png;base64,iVBORw0KGgo=" alt="dot">';
        const out = sanitizeRenderedHtml(input);
        expect(out).toContain('data:image/png;base64,');
        expect(out).toContain('alt="dot"');
    });

    it('preserves data-source-line on heading and paragraph tokens', () => {
        const input = '<h2 data-source-line="2">Heading</h2><p data-source-line="4">Body</p>';
        const out = sanitizeRenderedHtml(input);
        expect(out).toContain('data-source-line="2"');
        expect(out).toContain('data-source-line="4"');
    });
});

describe('sanitizeRenderedHtml — idempotence', () => {
    it('is a fixed point on already-sanitized output', () => {
        const input = '<p>hi <script>x</script></p><a href="javascript:1">x</a>';
        const once = sanitizeRenderedHtml(input);
        const twice = sanitizeRenderedHtml(once);
        expect(twice).toBe(once);
    });

    it('is a fixed point on a complex preserved tree', () => {
        const input = '<h1 data-source-line="1"><a href="#x" class="header-anchor"><svg class="header-anchor-icon"><path d="M0 0"/></svg></a>Title</h1><pre data-source-line="3"><code class="language-mermaid">A-->B</code></pre>';
        const once = sanitizeRenderedHtml(input);
        const twice = sanitizeRenderedHtml(once);
        expect(twice).toBe(once);
    });
});
