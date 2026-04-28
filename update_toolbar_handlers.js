const fs = require('fs');
let lines = fs.readFileSync('webview/toolbar.ts', 'utf8').split(/\r?\n/);

const targetIdx = lines.findIndex(l => l.includes('payload: { headingSize: label }'));
if (targetIdx !== -1) {
    const insertIdx = targetIdx + 3; 
    const clickHandlerLines = [
        '                if (group === \'line-spacing\') {',
        '                    const value = chip.dataset.value as \'compact\' | \'normal\' | \'relaxed\';',
        '                    const map = { compact: \'1.5\', normal: \'1.72\', relaxed: \'2.0\' };',
        '                    document.documentElement.style.setProperty(\'--line-height-body\', map[value]);',
        '                    this.vscode.postMessage({ type: \'update-settings\', payload: { lineSpacing: value } });',
        '                }',
        '',
        '                if (group === \'page-width\') {',
        '                    const value = chip.dataset.value as \'narrow\' | \'standard\' | \'wide\';',
        '                    const paper = document.getElementById(\'document-paper\');',
        '                    if (paper) {',
        '                        paper.className = paper.className.replace(/width-\\w+/g, \'\').trim();',
        '                        paper.classList.add(`width-${value}`);',
        '                    }',
        '                    this.vscode.postMessage({ type: \'update-settings\', payload: { pageWidth: value } });',
        '                }'
    ];
    lines.splice(insertIdx, 0, ...clickHandlerLines);
}
fs.writeFileSync('webview/toolbar.ts', lines.join('\n'));
console.log('done!');
