import MarkdownIt from 'markdown-it';
import markdownItAnchor from 'markdown-it-anchor';
import markdownItToc from 'markdown-it-toc-done-right';
import markdownItKatex from '@vscode/markdown-it-katex';
import hljs from 'highlight.js';
import { slugify } from '../shared/types';

const SOURCE_LINE_TARGETS = new Set([
    'paragraph_open', 'heading_open', 'list_item_open',
    'blockquote_open', 'table_open', 'fence', 'hr', 'html_block'
]);

export class MarkdownEngine {
    private md: MarkdownIt;

    constructor() {
        this.md = new MarkdownIt({
            html: true,
            linkify: true,
            typographer: false,
            highlight: (str, lang) => {
                // This highlight fn is called by the default fence renderer only,
                // but we override fence below — so this path is only hit if our
                // override doesn't match. Keep it as safe fallback.
                const language = lang?.trim();
                if (language && hljs.getLanguage(language)) {
                    try {
                        return this.highlightInner(str, language);
                    } catch (__) { }
                }
                if (!language) {
                    return this.highlightQuotedStrings(str);
                }
                return '';
            }
        })
            .use(markdownItAnchor, {
                permalink: false,
                slugify: slugify
            })
            .use(markdownItToc, { containerClass: 'auto-toc', listType: 'ul' })
            .use(markdownItKatex);

        this.md.renderer.rules.code_inline = (tokens, idx) => {
            return `<code class="hljs code-inline">${this.highlightQuotedStrings(tokens[idx].content)}</code>`;
        };

        // Override fence renderer so data-source-line attr appears on <pre>.
        // The default fence renderer ignores token attrs when highlight() returns a full <pre>.
        // NOTE: if a future refactor replaces <pre> with <div class="mermaid">,
        // transfer data-source-line from the pre to the new div to keep scroll sync anchors.
        const md = this.md;
        md.renderer.rules.fence = (tokens, idx) => {
            const token = tokens[idx];
            const sourceLine = token.attrGet('data-source-line') ?? '';
            const rawLang = token.info ? token.info.trim().split(/\s+/)[0] : '';
            const escapedLang = rawLang ? md.utils.escapeHtml(rawLang) : '';
            const langClass = escapedLang ? ` language-${escapedLang}` : '';

            // Mermaid: skip highlighter, preserve class for webview detection
            if (rawLang === 'mermaid') {
                const escaped = md.utils.escapeHtml(token.content);
                return `<pre data-source-line="${sourceLine}"><code class="language-mermaid">${escaped}</code></pre>`;
            }

            let inner: string;
            if (rawLang && hljs.getLanguage(rawLang)) {
                try {
                    inner = this.highlightMemberRoots(
                        hljs.highlight(token.content, { language: rawLang, ignoreIllegals: true }).value
                    );
                } catch (__) {
                    inner = md.utils.escapeHtml(token.content);
                }
            } else if (!rawLang) {
                inner = this.highlightQuotedStrings(token.content);
            } else {
                inner = md.utils.escapeHtml(token.content);
            }

            return `<pre data-source-line="${sourceLine}"><code class="hljs${langClass}">${inner}</code></pre>`;
        };
    }

    /**
     * Render markdown to HTML.
     * @param markdown - Markdown content (frontmatter already stripped).
     * @param lineOffset - Lines stripped from the top (frontmatter block count).
     */
    public render(markdown: string, lineOffset: number = 0): string {
        const normalized = markdown.normalize('NFC');
        const env: any = {};
        const tokens = this.md.parse(normalized, env);

        // Inject data-source-line on block-level tokens that have source map info
        for (const token of tokens) {
            if (token.map && SOURCE_LINE_TARGETS.has(token.type)) {
                token.attrSet('data-source-line', String(token.map[0] + lineOffset));
            }
        }

        return this.md.renderer.render(tokens, this.md.options, env);
    }

    /** Returns highlighted inner HTML (no wrapping <pre><code>). */
    private highlightInner(str: string, language: string): string {
        return this.highlightMemberRoots(
            hljs.highlight(str, { language, ignoreIllegals: true }).value
        );
    }

    private highlightQuotedStrings(value: string): string {
        const pattern = /'([^'\\]*(?:\\.[^'\\]*)*)'/g;
        let html = '';
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(value)) !== null) {
            html += this.md.utils.escapeHtml(value.slice(lastIndex, match.index));
            html += `<span class="hljs-string">${this.md.utils.escapeHtml(match[0])}</span>`;
            lastIndex = pattern.lastIndex;
        }

        html += this.md.utils.escapeHtml(value.slice(lastIndex));
        return html;
    }

    private highlightMemberRoots(value: string): string {
        return value.replace(/(^|[^\w$>&])([A-Za-z_$][\w$]*)(\.)/g, '$1<span class="hljs-variable">$2</span>$3');
    }
}
