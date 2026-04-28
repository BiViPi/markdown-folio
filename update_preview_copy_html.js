const fs = require('fs');
let lines = fs.readFileSync('src/PreviewPanel.ts', 'utf8').split(/\r?\n/);

// 1. Add `case 'copy-html':` to `onDidReceiveMessage`
const switchEndIdx = lines.findIndex(l => l.includes('case \'export-docx\':'));
if (switchEndIdx !== -1) {
    const caseLines = [
        '                    case \'copy-html\':',
        '                        this._handleCopyHtml();',
        '                        return;'
    ];
    lines.splice(switchEndIdx, 0, ...caseLines);
}

// 2. Add `private async _handleCopyHtml()`
const handleExportHtmlIdx = lines.findIndex(l => l.includes('private async _handleExportHtml()'));
if (handleExportHtmlIdx !== -1) {
    const handleMethodLines = [
        '    private async _handleCopyHtml() {',
        '        if (!this._guardContent()) return;',
        '        const snippet = HtmlBuilder.buildClipboardHtmlSnippet({',
        '            html: this._lastRenderedHtml,',
        '        });',
        '        await vscode.env.clipboard.writeText(snippet);',
        '        vscode.window.showInformationMessage(\'HTML source copied to clipboard\');',
        '    }',
        ''
    ];
    lines.splice(handleExportHtmlIdx, 0, ...handleMethodLines);
}

// 3. Add toolbar button
const htmlExportBtnIdx = lines.findIndex(l => l.includes('<button class="export-pill" id="export-html" title="Export HTML">HTML</button>'));
if (htmlExportBtnIdx !== -1) {
    lines.splice(htmlExportBtnIdx + 1, 0, '                    <button class="export-pill" id="copy-html" title="Copy HTML Source">Source</button>');
}

fs.writeFileSync('src/PreviewPanel.ts', lines.join('\n'));
console.log('PreviewPanel.ts updated for copy-html');
