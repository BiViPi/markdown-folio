const fs = require('fs');
let lines = fs.readFileSync('webview/toolbar.ts', 'utf8').split(/\r?\n/);

const exportHtmlIdx = lines.findIndex(l => l.includes('document.getElementById(\'export-html\')?.addEventListener(\'click\''));
if (exportHtmlIdx !== -1) {
    const listenerLines = [
        '        document.getElementById(\'copy-html\')?.addEventListener(\'click\', () => {',
        '            this.vscode.postMessage({ type: \'copy-html\', payload: {} });',
        '        });',
        ''
    ];
    lines.splice(exportHtmlIdx, 0, ...listenerLines);
}

fs.writeFileSync('webview/toolbar.ts', lines.join('\n'));
console.log('webview/toolbar.ts updated for copy-html');
