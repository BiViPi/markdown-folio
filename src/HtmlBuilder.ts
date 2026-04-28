import * as fs from 'fs';
import * as path from 'path';
import { TocItem } from './shared/types';

export interface PdfSettings {
    headingFont?: string;
    bodyFont?: string;
    fontSize?: number;
    headingSize?: 'S' | 'M' | 'L';
    lineSpacing?: string;
    pageWidth?: 'narrow' | 'standard' | 'wide';
    showToolbar?: boolean;
    showTocSidebar?: boolean;
    theme?: 'admiral' | 'ivory' | 'serene' | 'cyberpunk' | 'dracula' | 'github';
}

export class HtmlBuilder {
    /**
     * Tạo HTML self-contained cho PDF.
     * Đọc document.pdf.css từ distDir và inject inline.
     * CSS variables được override theo settings người dùng.
     */
    static buildPdfHtml(params: {
        html: string;
        distDir: string;
        settings?: PdfSettings;
        title?: string;
    }): string {
        const { html, distDir, settings, title } = params;

        // Đọc PDF stylesheet (mirrors preview light-mode visual)
        const pdfCss = HtmlBuilder._readDistOrSourceCss(distDir, 'document.pdf.css');

        // Đọc KaTeX CSS
        const katexCssPath = path.join(distDir, 'katex.css');
        const katexCss = fs.existsSync(katexCssPath)
            ? fs.readFileSync(katexCssPath, 'utf-8')
            : '';

        const themeCss = HtmlBuilder._readDistOrSourceCss(distDir, 'theme.css');

        const themeClass = HtmlBuilder._themeClass(settings?.theme);
        const themeOverrides = HtmlBuilder._buildPdfThemeOverrides(themeCss, settings?.theme);

        // Inject settings overrides
        const settingsOverrides = HtmlBuilder._buildSettingsOverrides(settings, true);

        // base href giúp relative URL trong katex.css (fonts/) resolve đúng từ distDir
        const baseHref = distDir.replace(/\\/g, '/');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title ? title.replace(/</g, '&lt;') : 'Document'}</title>
    <base href="file:///${baseHref}/">
    <style>${pdfCss}</style>
    ${themeOverrides ? `<style>${themeOverrides}</style>` : ''}
    <style>${katexCss}</style>
    ${settingsOverrides ? `<style>${settingsOverrides}</style>` : ''}
</head>
<body class="${themeClass}">
    <div id="document-content">${html}</div>
    <script src="mermaid.min.js"><\/script>
    <script>
        (function() {
            // Convert <code class="language-mermaid"> blocks to <div class="mermaid">
            document.querySelectorAll('code.language-mermaid').forEach(function(el) {
                var div = document.createElement('div');
                div.className = 'mermaid';
                div.textContent = el.textContent;
                var pre = el.closest('pre');
                if (pre) { pre.replaceWith(div); } else { el.replaceWith(div); }
            });
            window._mermaidDone = false;
                mermaid.initialize({ startOnLoad: false, theme: ${HtmlBuilder._isDarkTheme(settings?.theme) ? "'dark'" : "'default'"}, securityLevel: 'loose' });
            mermaid.run({ querySelector: '.mermaid' }).then(function() {
                window._mermaidDone = true;
            }).catch(function() {
                window._mermaidDone = true;
            });
        })();
    <\/script>
</body>
</html>`;
    }

    /**
     * Tạo HTML self-contained cho HTML export (chia sẻ).
     * Visual giống preview: dark/light background + A4 paper card.
     * Fonts từ Google Fonts CDN. KaTeX fonts inline base64. Mermaid CDN.
     */
    static buildExportHtml(params: {
        html: string;
        distDir: string;
        settings?: PdfSettings;
        title?: string;
        toc?: TocItem[];
    }): string {
        const { html, distDir, settings, title, toc = [] } = params;

        const themeCss = HtmlBuilder._readDistOrSourceCss(distDir, 'theme.css');
        const documentCss = HtmlBuilder._readDistOrSourceCss(distDir, 'document.css');
        const sidebarCss = HtmlBuilder._readDistOrSourceCss(distDir, 'sidebar.css');

        // Đọc KaTeX CSS và inline fonts base64
        let katexCss = fs.existsSync(path.join(distDir, 'katex.css'))
            ? fs.readFileSync(path.join(distDir, 'katex.css'), 'utf-8') : '';
        katexCss = HtmlBuilder._inlineFontUrls(katexCss, distDir, /url\((fonts\/[^)]+)\)/g);

        const settingsOverrides = HtmlBuilder._buildSettingsOverrides(settings, false);
        const bodyClass = HtmlBuilder._themeClass(settings?.theme);
        const sidebarHtml = settings?.showTocSidebar === false ? '' : HtmlBuilder._buildTocHtml(toc);
        const pageWidth = settings?.pageWidth || 'standard';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title ? title.replace(/</g, '&lt;') : 'Document'}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500&family=Merriweather:wght@400;700&display=swap">
    <style>${themeCss}</style>
    <style>${documentCss}</style>
    <style>${sidebarCss}</style>
    <style>${katexCss}</style>
    ${settingsOverrides ? `<style>${settingsOverrides}</style>` : ''}
    <style>
        #document-container { padding-top: 32px; min-height: 100vh; }
        #sidebar-toc a { color: inherit; text-decoration: none; display: block; }
    </style>
</head>
<body class="${bodyClass}">
    <div class="workspace-shell">
        ${sidebarHtml ? `<aside id="sidebar-toc">${sidebarHtml}</aside>` : ''}
        <main id="document-container">
            <div id="document-paper" class="width-${pageWidth}">
                <div id="document-content">${html}</div>
            </div>
        </main>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
    <script>
        (function() {
            window._mermaidDone = false;
            document.querySelectorAll('code.language-mermaid').forEach(function(el) {
                var div = document.createElement('div');
                div.className = 'mermaid';
                div.textContent = el.textContent;
                var pre = el.closest('pre');
                if (pre) { pre.replaceWith(div); } else { el.replaceWith(div); }
            });
            mermaid.initialize({ startOnLoad: true, theme: ${HtmlBuilder._isDarkTheme(settings?.theme) ? "'dark'" : "'default'"}, securityLevel: 'loose' });
            mermaid.run({ querySelector: '.mermaid' }).then(function() {
                window._mermaidDone = true;
            }).catch(function() {
                window._mermaidDone = true;
            });
        })();
    </script>
</body>
</html>`;
    }

    private static _readDistOrSourceCss(distDir: string, fileName: string): string {
        const distPath = path.join(distDir, fileName);
        if (fs.existsSync(distPath)) {
            return fs.readFileSync(distPath, 'utf-8');
        }

        const sourcePath = path.join(distDir, '..', 'webview', 'styles', fileName);
        if (fs.existsSync(sourcePath)) {
            return fs.readFileSync(sourcePath, 'utf-8');
        }

        return '';
    }

    private static _themeClass(theme?: PdfSettings['theme']): string {
        return `${theme || 'ivory'}-mode`;
    }

    private static _isDarkTheme(theme?: PdfSettings['theme']): boolean {
        return !['ivory', 'serene', 'github'].includes(theme || 'ivory');
    }

    private static _buildPdfThemeOverrides(themeCss: string, theme?: PdfSettings['theme']): string {
        const themeName = theme || 'ivory';
        const match = new RegExp(`body\\.${themeName}-mode\\s*\\{([\\s\\S]*?)\\n\\}`, 'm').exec(themeCss);
        if (!match) { return ''; }

        const vars = match[1]
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.startsWith('--'))
            .join('\n');

        return `
body.${themeName}-mode {
${vars}
    color: #111827;
    background: #ffffff;
    --text-primary: #111827;
    --text-muted: #4b5563;
    --page-bg: #ffffff;
    --app-bg: #ffffff;
    --app-bg-glow-1: rgba(0, 0, 0, 0);
    --app-bg-glow-2: rgba(0, 0, 0, 0);
    --code-bg: rgba(0, 0, 0, 0.05);
    --quote-bg: rgba(0, 0, 0, 0.04);
    --table-th-bg: rgba(0, 0, 0, 0.06);
    --table-tr-bg: rgba(0, 0, 0, 0.02);
    --border-color: rgba(0, 0, 0, 0.14);
    ${themeName === 'dracula' ? '--gold-color: #7c3aed;' : ''}
}
body.${themeName}-mode #document-content {
    color: var(--text-primary);
    font-family: var(--font-body);
}
body.${themeName}-mode h1,
body.${themeName}-mode h2 {
    color: var(--gold-color);
}
body.${themeName}-mode h1 {
    border-bottom-color: color-mix(in oklab, var(--gold-color) 32%, transparent);
}
body.${themeName}-mode h3,
body.${themeName}-mode h4,
body.${themeName}-mode h5,
body.${themeName}-mode h6 {
    color: var(--text-primary);
}
body.${themeName}-mode a {
    color: var(--accent-color);
}
body.${themeName}-mode blockquote {
    border-left-color: color-mix(in oklab, var(--gold-color) 60%, transparent);
    color: var(--text-muted);
    background: var(--quote-bg);
}
body.${themeName}-mode pre {
    background: var(--code-bg);
    border-color: var(--border-color);
}
body.${themeName}-mode code {
    background: var(--code-bg);
    color: var(--gold-color);
}
body.${themeName}-mode th,
body.${themeName}-mode td {
    border-color: var(--border-color);
}
body.${themeName}-mode th {
    background: var(--table-th-bg);
    color: var(--table-th-color, var(--gold-color));
}
body.${themeName}-mode tr:nth-child(even) {
    background: var(--table-tr-bg);
}
body.${themeName}-mode hr {
    border-top-color: var(--border-color);
}`;
    }

    private static _buildTocHtml(toc: TocItem[]): string {
        if (toc.length === 0) { return ''; }
        const items = toc.map(item => {
            const text = item.text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            return `<div class="toc-item level-${item.level}"><a href="#${item.slug}">${text}</a></div>`;
        }).join('\n');
        return `<div class="toc-header">Contents</div>\n${items}`;
    }

    private static _inlineFontUrls(css: string, distDir: string, pattern: RegExp): string {
        const mimeMap: Record<string, string> = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf' };
        return css.replace(pattern, (_match, relativePath) => {
            const fontPath = path.join(distDir, relativePath);
            if (!fs.existsSync(fontPath)) { return _match; }
            const ext = path.extname(fontPath).slice(1).toLowerCase();
            const mime = mimeMap[ext] || 'font/woff2';
            const b64 = fs.readFileSync(fontPath).toString('base64');
            return `url('data:${mime};base64,${b64}')`;
        });
    }

    private static _buildSettingsOverrides(settings?: PdfSettings, usePt = true): string {
        if (!settings) { return ''; }

        const lines: string[] = [];

        if (settings.headingFont) {
            lines.push(`h1, h3, h4, h5, h6 { font-family: ${settings.headingFont}, Georgia, serif; }`);
        }
        if (settings.headingSize) {
            const hMap: Record<string, [string, string, string]> = usePt
                ? { S: ['18pt', '14pt', '11pt'], M: ['22pt', '17pt', '13pt'], L: ['28pt', '21pt', '16pt'] }
                : { S: ['1.6rem', '1.2rem', '1.0rem'], M: ['2rem', '1.46rem', '1.22rem'], L: ['2.5rem', '1.8rem', '1.5rem'] };
            const [h1, h2, h3] = hMap[settings.headingSize] ?? hMap['M'];
            lines.push(`h1 { font-size: ${h1}; } h2 { font-size: ${h2}; } h3, h4, h5, h6 { font-size: ${h3}; }`);
        }
        if (settings.bodyFont) {
            lines.push(`body, #document-content { font-family: ${settings.bodyFont}, 'Segoe UI', system-ui, sans-serif; }`);
        }
        if (settings.fontSize) {
            if (usePt) {
                // settings.fontSize là px, PDF cần pt: 1px = 0.75pt (tại 96dpi)
                const pt = (settings.fontSize * 0.75).toFixed(1);
                lines.push(`body { font-size: ${pt}pt; }`);
            } else {
                lines.push(`body { font-size: ${settings.fontSize}px; }`);
            }
        }
        if (settings.lineSpacing) {
            const lineHeightMap: Record<string, string> = { compact: '1.5', normal: '1.72', relaxed: '2.0' };
            const lh = lineHeightMap[settings.lineSpacing] ?? '1.72';
            lines.push(`body { line-height: ${lh}; }`);
        }

        return lines.join('\n');
    }

    /**
     * Build HTML snippet for copying to clipboard.
     * V1 just returns the wrapped rendered HTML without inlining CSS.
     */
    static buildClipboardHtmlSnippet(params: { html: string }): string {
        return `<div class="markdown-folio-content">
${params.html}
</div>`;
    }
}
