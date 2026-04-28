const fs = require('fs');
let lines = fs.readFileSync('src/PreviewPanel.ts', 'utf8').split(/\r?\n/);

const headingEndIdx = lines.findIndex(l => l.includes('data-group="heading-size">L</button>'));
if (headingEndIdx !== -1) {
    const insertIdx = headingEndIdx + 3; // After </div>\n</div>
    const newLines = [
        '                        <div class="set-row">',
        '                            <span class="set-row-label">Line spacing</span>',
        '                            <div class="set-chips">',
        '                                <button class="set-chip" data-group="line-spacing" data-value="compact">Compact</button>',
        '                                <button class="set-chip" data-group="line-spacing" data-value="normal">Normal</button>',
        '                                <button class="set-chip" data-group="line-spacing" data-value="relaxed">Relaxed</button>',
        '                            </div>',
        '                        </div>'
    ];
    lines.splice(insertIdx, 0, ...newLines);
}

const tocSidebarIdx = lines.findIndex(l => l.includes('<span class="set-row-label">TOC Sidebar</span>'));
if (tocSidebarIdx !== -1) {
    const insertIdx = tocSidebarIdx - 1; // Before <div class="set-row"> for TOC Sidebar
    const newLines = [
        '                        <div class="set-row">',
        '                            <span class="set-row-label">Page width</span>',
        '                            <div class="set-chips">',
        '                                <button class="set-chip" data-group="page-width" data-value="narrow">Narrow</button>',
        '                                <button class="set-chip" data-group="page-width" data-value="standard">Standard</button>',
        '                                <button class="set-chip" data-group="page-width" data-value="wide">Wide</button>',
        '                            </div>',
        '                        </div>'
    ];
    lines.splice(insertIdx, 0, ...newLines);
}

fs.writeFileSync('src/PreviewPanel.ts', lines.join('\n'));
console.log('done!');
