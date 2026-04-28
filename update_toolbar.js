const fs = require('fs');
let lines = fs.readFileSync('webview/toolbar.ts', 'utf8').split(/\r?\n/);

// 1. Insert click handler logic
const headingSizeEnd = lines.findIndex(l => l.includes('this.vscode.postMessage({') && lines[l - 1] && lines[l - 1].includes('payload: { headingSize: label }'));
if (headingSizeEnd !== -1) {
    const insertIdx = headingSizeEnd + 4; // After `}` and `}`
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

// 2. Add to syncFromSettings type signature
const bodyFontIdx = lines.findIndex(l => l.includes('bodyFont?: string;'));
if (bodyFontIdx !== -1) {
    const signatureLines = [
        '        lineSpacing?: \'compact\' | \'normal\' | \'relaxed\';',
        '        pageWidth?: \'narrow\' | \'standard\' | \'wide\';'
    ];
    lines.splice(bodyFontIdx + 1, 0, ...signatureLines);
}

// 3. Add to syncFromSettings logic
const tocSidebarSyncIdx = lines.findIndex(l => l.includes('// Sync TOC sidebar toggle'));
if (tocSidebarSyncIdx !== -1) {
    const syncLogicLines = [
        '        // Sync line spacing chips',
        '        if (settings.lineSpacing !== undefined) {',
        '            document.querySelectorAll<HTMLElement>(\'.set-chip[data-group="line-spacing"]\').forEach(c => {',
        '                c.classList.toggle(\'active\', c.dataset.value === settings.lineSpacing);',
        '            });',
        '        }',
        '',
        '        // Sync page width chips',
        '        if (settings.pageWidth !== undefined) {',
        '            document.querySelectorAll<HTMLElement>(\'.set-chip[data-group="page-width"]\').forEach(c => {',
        '                c.classList.toggle(\'active\', c.dataset.value === settings.pageWidth);',
        '            });',
        '        }',
        ''
    ];
    lines.splice(tocSidebarSyncIdx, 0, ...syncLogicLines);
}

fs.writeFileSync('webview/toolbar.ts', lines.join('\n'));
console.log('toolbar.ts updated');
