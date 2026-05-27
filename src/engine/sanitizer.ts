import sanitizeHtml from 'sanitize-html';

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
 *   - Pure function (no I/O, no globals).
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
 * The allowlist is intentionally explicit so the extension can keep security
 * hardening without pulling a full jsdom runtime into the extension host.
 * Adding new attributes here is fine; the smoke tests in test/sanitizer.test.ts
 * guard the contract.
 */

const ALLOWED_TAGS = Array.from(new Set([
    ...sanitizeHtml.defaults.allowedTags,
    'details',
    'summary',
    'figure',
    'figcaption',
    'img',
    'math',
    'semantics',
    'annotation',
    'mrow',
    'mi',
    'mn',
    'mo',
    'msup',
    'msub',
    'msubsup',
    'mfrac',
    'msqrt',
    'mroot',
    'munder',
    'mover',
    'munderover',
    'mspace',
    'mtext',
    'mtable',
    'mtr',
    'mtd',
    'svg',
    'g',
    'path',
    'line',
    'polyline',
    'polygon',
    'rect',
    'circle',
    'ellipse',
    'text',
    'tspan',
    'defs',
    'marker',
    'clipPath',
    'symbol',
    'use',
]));

const ALLOWED_ATTRIBUTES: sanitizeHtml.IOptions['allowedAttributes'] = {
    '*': [
        'id',
        'class',
        'style',
        'title',
        'role',
        'tabindex',
        'dir',
        'lang',
        'data-*',
        'aria-*',
    ],
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'srcset'],
    details: ['open'],
    math: ['xmlns', 'display'],
    annotation: ['encoding'],
    svg: ['xmlns', 'viewBox', 'width', 'height', 'fill', 'stroke', 'stroke-width', 'preserveAspectRatio'],
    g: ['transform', 'fill', 'stroke', 'stroke-width', 'clip-path'],
    path: ['d', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'transform'],
    line: ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width', 'stroke-linecap'],
    polyline: ['points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'],
    polygon: ['points', 'fill', 'stroke', 'stroke-width', 'stroke-linejoin'],
    rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke', 'stroke-width'],
    circle: ['cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width'],
    ellipse: ['cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'stroke-width'],
    text: ['x', 'y', 'dx', 'dy', 'text-anchor', 'font-size', 'font-family', 'fill', 'stroke'],
    tspan: ['x', 'y', 'dx', 'dy', 'text-anchor'],
    defs: [],
    marker: ['id', 'viewBox', 'refX', 'refY', 'markerWidth', 'markerHeight', 'orient'],
    clipPath: ['id'],
    symbol: ['id', 'viewBox'],
    use: ['href', 'xlink:href', 'x', 'y', 'width', 'height'],
};

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
        img: ['data', 'http', 'https'],
    },
    allowedSchemesAppliedToAttributes: ['href', 'src', 'cite', 'xlink:href'],
    allowProtocolRelative: false,
    parser: {
        lowerCaseTags: false,
        lowerCaseAttributeNames: false,
    },
};

/**
 * Sanitize rendered HTML before it reaches preview or export templates.
 *
 * @param html Output of MarkdownEngine.render (raw or TikZ-resolved).
 * @returns Sanitized HTML string with disallowed elements/attributes removed.
 */
export function sanitizeRenderedHtml(html: string): string {
    return sanitizeHtml(html, SANITIZE_OPTIONS);
}
