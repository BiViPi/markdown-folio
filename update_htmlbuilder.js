const fs = require('fs');
let content = fs.readFileSync('src/HtmlBuilder.ts', 'utf8');

const newMethod = `
    /**
     * Build HTML snippet for copying to clipboard.
     * V1 just returns the wrapped rendered HTML without inlining CSS.
     */
    static buildClipboardHtmlSnippet(params: { html: string }): string {
        return \`<div class="markdown-folio-content">
\${params.html}
</div>\`;
    }
`;

content = content.replace(/\}\s*$/, newMethod + '}\n');
fs.writeFileSync('src/HtmlBuilder.ts', content);
console.log('HtmlBuilder.ts updated');
