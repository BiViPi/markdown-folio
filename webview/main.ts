import { Renderer } from './renderer';
import { Toolbar } from './toolbar';
import { Toc } from './toc';
import { ScrollSync } from './scrollSync';
import { Lightbox } from './lightbox';
import mermaid from 'mermaid';
import './styles/theme.css';
import './styles/document.css';
import './styles/toolbar.css';
import './styles/sidebar.css';

declare const acquireVsCodeApi: any;
const vscode = acquireVsCodeApi();

const renderer = new Renderer('document-content');
const toolbar = new Toolbar(vscode);
const toc = new Toc('sidebar-toc');
const scrollSync = new ScrollSync(vscode, 'document-container');
const lightbox = new Lightbox();

// Center toolbar over #document-container (not full viewport, to account for TOC sidebar)
function syncToolbarPosition() {
    const container = document.getElementById('document-container');
    const tb = document.getElementById('toolbar');
    if (!container || !tb) { return; }
    const rect = container.getBoundingClientRect();
    
    if (tb.classList.contains('collapsed')) {
        // Pin to the right edge of the document container
        tb.style.left = `${rect.right - 24}px`;
        tb.style.transform = 'translateX(-100%)';
    } else {
        tb.style.left = `${rect.left + rect.width / 2}px`;
        tb.style.transform = 'translateX(-50%)';
    }
}
(window as any).syncToolbarPosition = syncToolbarPosition;

const resizeObserver = new ResizeObserver(syncToolbarPosition);
resizeObserver.observe(document.getElementById('document-container') ?? document.body);
window.addEventListener('resize', syncToolbarPosition);
syncToolbarPosition();

function getMermaidTheme(): 'dark' | 'default' {
    const isDarkTheme = !document.body.classList.contains('ivory-mode') && !document.body.classList.contains('sepia-mode');
    return isDarkTheme ? 'dark' : 'default';
}

function prepareMermaidNodes(nodes: HTMLElement[], restoreSource: boolean): void {
    nodes.forEach(el => {
        if (!el.dataset.mermaidSource) {
            el.dataset.mermaidSource = el.textContent || '';
        }
        if (restoreSource) {
            el.textContent = el.dataset.mermaidSource || '';
        }
        el.removeAttribute('data-processed');
        el.classList.remove('language-mermaid');
        el.classList.add('mermaid');
    });
}

function runMermaid(nodes: HTMLElement[], restoreSource: boolean): Promise<void> {
    if (nodes.length === 0) {
        return Promise.resolve();
    }
    prepareMermaidNodes(nodes, restoreSource);
    mermaid.initialize({ startOnLoad: false, theme: getMermaidTheme(), securityLevel: 'loose' });
    return mermaid.run({ nodes }).then(() => undefined);
}

// Handle messages from the extension host
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'render': {
            const { config, stats } = message.payload;
            if (config) {
                applySettings(config);
                toolbar.syncFromSettings(config);
                scrollSync.setEnabled(config.scrollSync !== false);
            }
            renderer.render(message.payload.html);
            toc.render(message.payload.toc);

            // Attach lightbox after each render (AbortController cleans up previous listeners).
            lightbox.attach(document.getElementById('document-content')!);

            // Update reading stats strip.
            if (stats) { updateDocStats(stats); }

            // Build scroll index immediately so sync works for non-mermaid content
            scrollSync.rebuildIndex();

            // Re-sync toolbar after TOC sidebar show/hide changes layout
            setTimeout(syncToolbarPosition, 50);

            // Render mermaid
            const mermaidCodes = document.querySelectorAll<HTMLElement>('.language-mermaid');
            if (mermaidCodes.length > 0) {
                const nodes = Array.from(mermaidCodes);
                // Rebuild index again after Mermaid finishes (async DOM changes shift positions)
                runMermaid(nodes, false)
                    .then(() => scrollSync.rebuildIndex())
                    .catch(() => scrollSync.rebuildIndex()); // Re-index even on failure (fallback <pre> still has anchor)
            }
            break;
        }
        case 'settings-updated': {
            const oldTheme = document.body.className;
            applySettings(message.payload);
            toolbar.syncFromSettings(message.payload);
            if (message.payload.scrollSync !== undefined) {
                scrollSync.setEnabled(message.payload.scrollSync !== false);
            }
            setTimeout(syncToolbarPosition, 50);
            
            // Re-render mermaid if theme actually changed
            if (oldTheme !== document.body.className) {
                const mermaidCodes = document.querySelectorAll<HTMLElement>('.mermaid');
                if (mermaidCodes.length > 0) {
                    const nodes = Array.from(mermaidCodes);
                    runMermaid(nodes, true)
                        .then(() => scrollSync.rebuildIndex())
                        .catch(() => scrollSync.rebuildIndex());
                }
            }
            break;
        }
        case 'scroll-to-line': {
            scrollSync.handleMessage(message);
            break;
        }
    }
});

interface DocStats {
    words: number;
    chars: number;
    readingTimeMin: number;
}

function updateDocStats(stats: DocStats): void {
    let el = document.getElementById('doc-stats');
    if (!el) {
        el = document.createElement('div');
        el.id = 'doc-stats';
        document.getElementById('document-paper')?.prepend(el);
    }
    el.textContent = `${stats.readingTimeMin} min read | ${stats.words.toLocaleString()} words | ${stats.chars.toLocaleString()} chars`;
}

function updatePrintMarginHeight(): void {
    const paper = document.getElementById('document-paper');
    if (!paper) { return; }
    const h = Math.round(paper.clientWidth * 297 / 210);
    document.documentElement.style.setProperty('--a4-page-h', `${h}px`);
}

window.addEventListener('resize', () => {
    if (document.getElementById('document-paper')?.classList.contains('show-print-margins')) {
        updatePrintMarginHeight();
    }
});

function applySettings(settings: {
    headingFont?: string;
    bodyFont?: string;
    fontSize?: number;
    headingSize?: 'S' | 'M' | 'L';
    lineSpacing?: string;
    pageWidth?: string;
    showToolbar?: boolean;
    toolbarCollapsed?: boolean;
    showTocSidebar?: boolean;
    showPrintMargins?: boolean;
    theme?: 'admiral' | 'ivory' | 'serene' | 'cyberpunk' | 'dracula' | 'github';
    scrollSync?: boolean;
}) {
    const root = document.documentElement;
    if (settings.headingFont) { root.style.setProperty('--font-heading', settings.headingFont); }
    if (settings.bodyFont) { root.style.setProperty('--font-body', settings.bodyFont); }
    if (settings.fontSize) { root.style.setProperty('--font-size-body', `${settings.fontSize}px`); }
    if (settings.headingSize) {
        const scaleMap: Record<string, string> = { S: '0.8', M: '1', L: '1.25' };
        root.style.setProperty('--heading-scale', scaleMap[settings.headingSize] ?? '1');
    }
    if (settings.lineSpacing) {
        const lineHeightMap: Record<string, string> = { compact: '1.5', normal: '1.72', relaxed: '2.0' };
        root.style.setProperty('--line-height-body', lineHeightMap[settings.lineSpacing] ?? '1.72');
    }
    if (settings.pageWidth) {
        const paper = document.getElementById('document-paper');
        if (paper) {
            paper.className = paper.className.replace(/width-\w+/g, '').trim();
            paper.classList.add(`width-${settings.pageWidth}`);
        }
    }
    if (settings.showToolbar !== undefined) {
        const tb = document.getElementById('toolbar');
        const container = document.getElementById('document-container');
        if (tb) {
            tb.style.display = settings.showToolbar ? '' : 'none';
        }
        if (container) {
            container.style.paddingTop = settings.showToolbar ? '' : '32px';
        }
    }
    if (settings.toolbarCollapsed !== undefined) {
        toolbar.syncFromSettings({ toolbarCollapsed: settings.toolbarCollapsed });
    }
    if (settings.showTocSidebar !== undefined) {
        const sidebar = document.getElementById('sidebar-toc');
        if (sidebar) {
            sidebar.style.display = settings.showTocSidebar ? '' : 'none';
        }
    }
    if (settings.theme !== undefined) {
        document.body.classList.remove('ivory-mode', 'admiral-mode', 'serene-mode', 'cyberpunk-mode', 'dracula-mode', 'github-mode');
        
        if (settings.theme === 'ivory') {
            document.body.classList.add('ivory-mode');
        } else if (settings.theme === 'admiral') {
            document.body.classList.add('admiral-mode');
        } else if (settings.theme === 'serene') {
            document.body.classList.add('serene-mode');
        } else if (settings.theme === 'cyberpunk') {
            document.body.classList.add('cyberpunk-mode');
        } else if (settings.theme === 'dracula') {
            document.body.classList.add('dracula-mode');
        } else if (settings.theme === 'github') {
            document.body.classList.add('github-mode');
        }
        
        // Update active state in theme dropdown
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', (btn as HTMLElement).dataset.theme === settings.theme);
        });
    }
    if (settings.showPrintMargins !== undefined) {
        const paper = document.getElementById('document-paper');
        if (paper) {
            paper.classList.toggle('show-print-margins', settings.showPrintMargins);
            if (settings.showPrintMargins) { updatePrintMarginHeight(); }
        }
    }
}

// Signal to extension that webview is ready to receive messages
vscode.postMessage({ type: 'ready' });
