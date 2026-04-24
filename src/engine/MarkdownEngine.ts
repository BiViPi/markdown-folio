import MarkdownIt from 'markdown-it';
import markdownItAnchor from 'markdown-it-anchor';
import markdownItToc from 'markdown-it-toc-done-right';
import markdownItKatex from '@vscode/markdown-it-katex';
import hljs from 'highlight.js';
import { slugify } from '../shared/types';

export class MarkdownEngine {
    private md: MarkdownIt;

    constructor() {
        this.md = new MarkdownIt({
            html: true,
            linkify: true,
            typographer: false,
            highlight: (str, lang) => {
                const language = lang?.trim();

                if (language && hljs.getLanguage(language)) {
                    try {
                        return this.wrapHighlightedCode(
                            this.highlightMemberRoots(hljs.highlight(str, { language, ignoreIllegals: true }).value),
                            language
                        );
                    } catch (__) { }
                }

                if (!language) {
                    return this.wrapHighlightedCode(this.highlightQuotedStrings(str));
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
    }

    public render(markdown: string): string {
        // NFC normalize to fix Vietnamese combining diacritics display
        return this.md.render(markdown.normalize('NFC'));
    }

    private wrapHighlightedCode(value: string, language?: string): string {
        const languageClass = language ? ` language-${this.md.utils.escapeHtml(language)}` : '';
        return `<pre><code class="hljs${languageClass}">${value}</code></pre>`;
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
