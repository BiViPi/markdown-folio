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
                if (lang && hljs.getLanguage(lang)) {
                    try {
                        return '<pre><code class="hljs language-' + lang + '">' +
                            hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
                            '</code></pre>';
                    } catch (__) { }
                }

                return '<pre><code class="hljs">' + this.md.utils.escapeHtml(str) + '</code></pre>';
            }
        })
            .use(markdownItAnchor, {
                permalink: false,
                slugify: slugify
            })
            .use(markdownItToc, { containerClass: 'auto-toc', listType: 'ul' })
            .use(markdownItKatex);
    }

    public render(markdown: string): string {
        // NFC normalize to fix Vietnamese combining diacritics display
        return this.md.render(markdown.normalize('NFC'));
    }
}
