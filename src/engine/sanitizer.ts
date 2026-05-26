import DOMPurify from 'isomorphic-dompurify';

/**
 * Sanitization layer for HTML produced by MarkdownEngine.render.
 *
 * Why this exists:
 *   markdown-it runs with html: true and there is no markdown-level sanitizer.
 *   Raw HTML in a .md file (including <script>) reaches the preview webview
 *   and every export template. The webview has a nonce-based CSP that blocks
 *   inline scripts, but the export templates do not (CSP is additive, see
 *   HtmlBuilder). Sanitization is the primary defense; CSP is defense-in-depth.
 *
 * Contract:
 *   - Pure function (no I/O, no globals beyond DOMPurify internals).
 *   - No vscode import — safe to unit-test in Node.
 *   - Idempotent: sanitize(sanitize(x)) === sanitize(x).
 *   - Preserves the placeholder shapes that downstream stages depend on:
 *       * `<pre data-source-line="..."><code class="language-mermaid">…</code></pre>`
 *       * `<div class="tikz-pending" data-tikz="…" data-source-line="…">` (and the
 *         resolved <svg>…</svg> that TikzRenderer substitutes in)
 *       * Header anchor SVG emitted by markdown-it-anchor
 *       * KaTeX output (large SVG / MathML / span tree)
 *       * data-source-line attributes for scroll sync
 *
 * Strip:
 *   - <script>, <iframe>, <object>, <embed>, <form>, <base>
 *   - on* event-handler attributes
 *   - javascript: / vbscript: URIs
 *
 * The allowlist intentionally leans on DOMPurify defaults plus a small set of
 * project-specific data attributes. Adding new attributes here is fine; the
 * smoke tests in test/sanitizer.test.ts guard the contract.
 */

const PROJECT_DATA_ATTRS: readonly string[] = [
    'data-source-line',
    'data-tikz',
    'data-mermaid-source',
    'data-processed',
];

const FORBID_TAGS: readonly string[] = ['form', 'base'];

const PURIFY_CONFIG: Parameters<typeof DOMPurify.sanitize>[1] = {
    ADD_ATTR: [...PROJECT_DATA_ATTRS],
    FORBID_TAGS: [...FORBID_TAGS],
    ALLOW_DATA_ATTR: true,
    // Keep the result as a string. DOMPurify.sanitize returns string by default
    // when RETURN_DOM is false (the default). Setting explicitly so future
    // refactors do not flip the return type accidentally.
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
};

/**
 * Sanitize rendered HTML before it reaches preview or export templates.
 *
 * @param html Output of MarkdownEngine.render (raw or TikZ-resolved).
 * @returns Sanitized HTML string with disallowed elements/attributes removed.
 */
export function sanitizeRenderedHtml(html: string): string {
    const result = DOMPurify.sanitize(html, PURIFY_CONFIG);
    // isomorphic-dompurify returns string when RETURN_DOM is false. The cast
    // shields callers from the union type DOMPurify advertises.
    return typeof result === 'string' ? result : String(result);
}
