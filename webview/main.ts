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
                const theme = document.body.classList.contains('light-mode') ? 'default' : 'dark';
                const nodes = Array.from(mermaidCodes);
                nodes.forEach(el => {
                    el.removeAttribute('data-processed');
                    el.classList.remove('language-mermaid');
                });
                mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'loose' });
                mermaid.run({ nodes }).catch(() => { /* silent */ });
            }
            break;
        }
        case 'settings-updated': {
            applySettings(message.payload);
            toolbar.syncFromSettings(message.payload);
            setTimeout(syncToolbarPosition, 50);
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
        if (settings.theme === 'light') {
            document.body.classList.add('light-mode');
        } else if (settings.theme === 'dark') {
            document.body.classList.remove('light-mode');
        } else {
            const isSystemLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
            if (isSystemLight) {
                document.body.classList.add('light-mode');
            } else {
                document.body.classList.remove('light-mode');
            }
        }

        const themeToggle = document.getElementById('theme-toggle');
        const currentIsLight = document.body.classList.contains('light-mode');
        const iconEl = themeToggle?.querySelector('svg');
        if (iconEl) {
            iconEl.innerHTML = currentIsLight
                ? '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
                : '<path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/>';
        }
    }
}

// Signal to extension that webview is ready to receive messages
vscode.postMessage({ type: 'ready' });
