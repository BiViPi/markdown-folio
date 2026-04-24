import { Renderer } from './renderer';
import { Toolbar } from './toolbar';
import { Toc } from './toc';
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

// Center toolbar over #document-container (not full viewport, to account for TOC sidebar)
function syncToolbarPosition() {
    const container = document.getElementById('document-container');
    const tb = document.getElementById('toolbar');
    if (!container || !tb) { return; }
    const rect = container.getBoundingClientRect();
    tb.style.left = `${rect.left + rect.width / 2}px`;
}

const resizeObserver = new ResizeObserver(syncToolbarPosition);
resizeObserver.observe(document.getElementById('document-container') ?? document.body);
window.addEventListener('resize', syncToolbarPosition);
syncToolbarPosition();

// Handle messages from the extension host
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'render': {
            const { config } = message.payload;
            if (config) {
                applySettings(config);
                toolbar.syncFromSettings(config);
            }
            renderer.render(message.payload.html);
            toc.render(message.payload.toc);

            // Re-sync toolbar after TOC sidebar show/hide changes layout
            setTimeout(syncToolbarPosition, 50);

            // Render mermaid
            const mermaidCodes = document.querySelectorAll<HTMLElement>('.language-mermaid');
            if (mermaidCodes.length > 0) {
                const isDarkTheme = !document.body.classList.contains('light-mode') && !document.body.classList.contains('sepia-mode');
                const theme = isDarkTheme ? 'dark' : 'default';
                const nodes = Array.from(mermaidCodes);
                nodes.forEach(el => {
                    el.removeAttribute('data-processed');
                    el.classList.remove('language-mermaid');
                    el.classList.add('mermaid'); // Fix class for re-render targeting
                });
                mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'loose' });
                mermaid.run({ nodes }).catch(() => { /* silent */ });
            }
            break;
        }
        case 'settings-updated': {
            const oldTheme = document.body.className;
            applySettings(message.payload);
            toolbar.syncFromSettings(message.payload);
            setTimeout(syncToolbarPosition, 50);
            
            // Re-render mermaid if theme actually changed
            if (oldTheme !== document.body.className) {
                const mermaidCodes = document.querySelectorAll<HTMLElement>('.mermaid');
                if (mermaidCodes.length > 0) {
                    const isDarkTheme = !document.body.classList.contains('light-mode') && !document.body.classList.contains('sepia-mode');
                    const theme = isDarkTheme ? 'dark' : 'default';
                    const nodes = Array.from(mermaidCodes);
                    nodes.forEach(el => el.removeAttribute('data-processed'));
                    mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'loose' });
                    mermaid.run({ nodes }).catch(() => { /* silent */ });
                }
            }
            break;
        }
    }
});

function applySettings(settings: {
    headingFont?: string;
    bodyFont?: string;
    fontSize?: number;
    headingSize?: 'S' | 'M' | 'L';
    lineSpacing?: string;
    pageWidth?: string;
    showTocSidebar?: boolean;
    theme?: 'dark' | 'light' | 'auto';
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
    if (settings.showTocSidebar !== undefined) {
        const sidebar = document.getElementById('sidebar-toc');
        if (sidebar) {
            sidebar.style.display = settings.showTocSidebar ? '' : 'none';
        }
    }
    if (settings.theme !== undefined) {
        document.body.classList.remove('light-mode', 'sepia-mode', 'midnight-mode');
        
        let actualTheme = settings.theme;
        if (actualTheme === 'auto') {
            const isSystemLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
            actualTheme = isSystemLight ? 'light' : 'dark';
        }

        if (actualTheme === 'light') {
            document.body.classList.add('light-mode');
        } else if (actualTheme === 'sepia') {
            document.body.classList.add('sepia-mode');
        } else if (actualTheme === 'midnight') {
            document.body.classList.add('midnight-mode');
        }
        
        // Update active state in theme dropdown
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', (btn as HTMLElement).dataset.theme === settings.theme);
        });
    }
}

// Signal to extension that webview is ready to receive messages
vscode.postMessage({ type: 'ready' });
