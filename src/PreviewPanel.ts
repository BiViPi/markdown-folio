import * as vscode from 'vscode';
import * as path from 'path';
import { MarkdownEngine } from './engine/MarkdownEngine';
import { PathResolver } from './utils/pathResolver';
import { FrontmatterParser } from './engine/FrontmatterParser';
import { TocGenerator } from './engine/TocGenerator';
import { debounce } from './utils/debounce';
import { SettingsManager } from './SettingsManager';
import { PdfExporter } from './PdfExporter';
import { HtmlBuilder } from './HtmlBuilder';
import { HtmlExporter } from './HtmlExporter';
import { PngExporter } from './PngExporter';
import { DocxExporter } from './DocxExporter';

export class PreviewPanel {
    private static readonly _markdownEngine = new MarkdownEngine();
    public static currentPanel: PreviewPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _document: vscode.TextDocument;
    private _disposables: vscode.Disposable[] = [];
    private _debounceUpdate = debounce(() => this._update(), 300);
    private _hasPendingRender = true;
    private _htmlInitialized = false;
    private _webviewReady = false;
    private _lastRenderedHtml = '';
    private _lastToc: import('./shared/types').TocItem[] = [];
    private _lastTitle = '';

    /**
     * Used by MarkdownFolioEditorProvider: VS Code supplies the panel, we just initialise it.
     * Does NOT set currentPanel — custom editor instances are managed by VS Code.
     */
    public static createFromExternalPanel(
        context: vscode.ExtensionContext,
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel
    ): PreviewPanel {
        panel.webview.options = {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')]
        };
        return new PreviewPanel(panel, context.extensionUri, document);
    }

    public static createOrShow(context: vscode.ExtensionContext, document: vscode.TextDocument) {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

        // If we already have a panel, show it.
        if (PreviewPanel.currentPanel) {
            PreviewPanel.currentPanel._document = document;
            PreviewPanel.currentPanel._hasPendingRender = true;
            PreviewPanel.currentPanel._update();
            PreviewPanel.currentPanel._panel.reveal(column);
            return;
        }

        // Otherwise, create a new panel.
        const panel = vscode.window.createWebviewPanel(
            'markdownFolioPreview',
            `Preview: ${path.basename(document.fileName)}`,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')]
            }
        );

        PreviewPanel.currentPanel = new PreviewPanel(panel, context.extensionUri, document);
    }

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, document: vscode.TextDocument) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._document = document;

        // Set the webview's initial html content
        this._update();

        // Listen for when the panel is disposed
        // This happens when the user closes the panel or when the panel is closed programmatically
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        // Listen for file changes
        vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document === this._document) {
                this._hasPendingRender = true;
                this._debounceUpdate();
            }
        }, null, this._disposables);

        // Listen for view state changes
        this._panel.onDidChangeViewState(() => {
            if (this._panel.visible && this._hasPendingRender) {
                this._update();
            }
        }, null, this._disposables);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(
            message => {
                switch (message.type) {
                    case 'ready':
                        this._webviewReady = true;
                        this._update();
                        return;
                    case 'alert':
                        vscode.window.showErrorMessage(message.payload);
                        return;
                    case 'update-settings':
                        SettingsManager.update(message.payload).catch(err => {
                            vscode.window.showErrorMessage(`Markdown Folio: Failed to save settings: ${err}`);
                        });
                        return;
                    case 'export-pdf': {
                        const { orientation, size } = message.payload as {
                            orientation: 'portrait' | 'landscape';
                            size: 'A4' | 'A3' | 'Letter';
                        };
                        this._handleExportPdf(orientation, size);
                        return;
                    }
                    case 'export-html': {
                        const { isDarkMode } = message.payload as { isDarkMode: boolean };
                        this._handleExportHtml(isDarkMode);
                        return;
                    }
                    case 'export-png-full':
                        this._handleExportPng('full');
                        return;
                    case 'export-png-pages':
                        this._handleExportPng('pages');
                        return;
                    case 'export-docx':
                        this._handleExportDocx();
                        return;
                }
            },
            null,
            this._disposables
        );

        // Listen for VS Code settings changes → push to webview immediately
        this._disposables.push(
            SettingsManager.onDidChange(settings => {
                if (this._panel.visible) {
                    this._panel.webview.postMessage({
                        type: 'settings-updated',
                        payload: settings
                    });
                }
            })
        );
    }

    public dispose() {
        PreviewPanel.currentPanel = undefined;

        // Clean up our resources
        this._panel.dispose();

        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _guardContent(): boolean {
        if (!this._lastRenderedHtml) {
            vscode.window.showWarningMessage('Markdown Folio: Chưa có nội dung để xuất. Hãy mở file Markdown trước.');
            return false;
        }
        return true;
    }

    private async _handleExportPdf(
        orientation: 'portrait' | 'landscape',
        size: 'A4' | 'A3' | 'Letter'
    ): Promise<void> {
        if (!this._guardContent()) { return; }
        try {
            const defaultName = path.basename(this._document.fileName, '.md') + '.pdf';
            const saveUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(
                    path.join(path.dirname(this._document.fileName), defaultName)
                ),
                filters: { 'PDF Files': ['pdf'] },
            });

            if (!saveUri) {
                return; // user cancelled
            }

            const distDir = path.join(this._extensionUri.fsPath, 'dist');
            const settings = SettingsManager.read();
            const pdfHtml = HtmlBuilder.buildPdfHtml({
                html: this._lastRenderedHtml,
                distDir,
                settings,
                title: this._lastTitle,
            });

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Markdown Folio: Đang xuất PDF...',
                    cancellable: false,
                },
                async () => {
                    await PdfExporter.export(pdfHtml, {
                        orientation,
                        size,
                        outputPath: saveUri.fsPath,
                        headings: this._lastToc.filter(h => h.level <= 3),
                    });
                }
            );

            const open = await vscode.window.showInformationMessage(
                `PDF đã xuất: ${path.basename(saveUri.fsPath)}`,
                'Mở file'
            );
            if (open === 'Mở file') {
                vscode.env.openExternal(saveUri);
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Markdown Folio: Export PDF thất bại — ${err.message}`);
        }
    }

    private async _handleExportHtml(isDarkMode: boolean): Promise<void> {
        if (!this._guardContent()) { return; }
        try {
            const defaultName = path.basename(this._document.fileName, '.md') + '.html';
            const saveUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(path.join(path.dirname(this._document.fileName), defaultName)),
                filters: { 'HTML Files': ['html'] },
            });
            if (!saveUri) { return; }

            const distDir = path.join(this._extensionUri.fsPath, 'dist');
            const settings = SettingsManager.read();
            const exportHtml = HtmlBuilder.buildExportHtml({
                html: this._lastRenderedHtml,
                distDir,
                settings,
                title: this._lastTitle,
                isDarkMode,
                toc: this._lastToc,
            });

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Markdown Folio: Đang xuất HTML...', cancellable: false },
                async () => { HtmlExporter.export(exportHtml, saveUri.fsPath); }
            );

            const open = await vscode.window.showInformationMessage(
                `HTML đã xuất: ${path.basename(saveUri.fsPath)}`, 'Mở file'
            );
            if (open === 'Mở file') { vscode.env.openExternal(saveUri); }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Markdown Folio: Export HTML thất bại — ${err.message}`);
        }
    }

    private async _handleExportPng(mode: 'full' | 'pages'): Promise<void> {
        if (!this._guardContent()) { return; }
        try {
            const baseName = path.basename(this._document.fileName, '.md');
            const distDir = path.join(this._extensionUri.fsPath, 'dist');
            const settings = SettingsManager.read();
            const pngHtml = HtmlBuilder.buildPdfHtml({
                html: this._lastRenderedHtml,
                distDir,
                settings,
                title: this._lastTitle,
            });

            if (mode === 'full') {
                const saveUri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(path.join(path.dirname(this._document.fileName), `${baseName}.png`)),
                    filters: { 'PNG Image': ['png'] },
                });
                if (!saveUri) { return; }

                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: 'Markdown Folio: Đang xuất PNG...', cancellable: false },
                    async () => {
                        await PngExporter.export(pngHtml, { outputPath: saveUri.fsPath, mode: 'full' });
                    }
                );
                const open = await vscode.window.showInformationMessage(
                    `PNG đã xuất: ${path.basename(saveUri.fsPath)}`, 'Mở file'
                );
                if (open === 'Mở file') { vscode.env.openExternal(saveUri); }
            } else {
                // Pages mode: chọn folder
                const folderUri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(path.join(path.dirname(this._document.fileName), `${baseName}-pages`)),
                    filters: { 'Folder name (no extension)': [''] },
                    title: 'Chọn thư mục xuất PNG Pages',
                });
                if (!folderUri) { return; }

                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: 'Markdown Folio: Đang xuất PNG Pages...', cancellable: false },
                    async () => {
                        await PngExporter.export(pngHtml, { outputPath: folderUri.fsPath, mode: 'pages' });
                    }
                );
                const open = await vscode.window.showInformationMessage(
                    `PNG Pages đã xuất vào: ${path.basename(folderUri.fsPath)}`, 'Mở thư mục'
                );
                if (open === 'Mở thư mục') { vscode.env.openExternal(folderUri); }
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Markdown Folio: Export PNG thất bại — ${err.message}`);
        }
    }

    private async _handleExportDocx(): Promise<void> {
        if (!this._guardContent()) { return; }
        try {
            const defaultName = path.basename(this._document.fileName, '.md') + '.docx';
            const saveUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(path.join(path.dirname(this._document.fileName), defaultName)),
                filters: { 'Word Document': ['docx'] },
            });
            if (!saveUri) { return; }

            const distDir = path.join(this._extensionUri.fsPath, 'dist');
            const settings = SettingsManager.read();

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Markdown Folio: Đang xuất DOCX...', cancellable: false },
                async () => {
                    await DocxExporter.export(this._lastRenderedHtml, {
                        outputPath: saveUri.fsPath,
                        title: this._lastTitle,
                        distDir,
                        settings,
                    });
                }
            );

            const open = await vscode.window.showInformationMessage(
                `DOCX đã xuất: ${path.basename(saveUri.fsPath)}`, 'Mở file'
            );
            if (open === 'Mở file') { vscode.env.openExternal(saveUri); }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Markdown Folio: Export DOCX thất bại — ${err.message}`);
        }
    }

    private _update() {
        const webview = this._panel.webview;

        const documentContent = this._document.getText();
        const documentDir = path.dirname(this._document.fileName);

        const { title, author, date, content } = FrontmatterParser.extract(documentContent);
        const base64MappedContent = PathResolver.resolveImages(content, documentDir);
        const toc = TocGenerator.extract(content);

        const html = PreviewPanel._markdownEngine.render(base64MappedContent);
        this._lastRenderedHtml = html;
        this._lastToc = toc;
        this._lastTitle = title || path.basename(this._document.fileName, '.md');

        // Update panel title
        this._panel.title = `Preview: ${title || path.basename(this._document.fileName)}`;

        if (!this._htmlInitialized) {
            this._panel.webview.html = this._getHtmlForWebview(webview);
            this._htmlInitialized = true;
        }

        if (this._panel.visible && this._webviewReady) {
            const settings = SettingsManager.read();
            this._panel.webview.postMessage({
                type: 'render',
                payload: {
                    html: html,
                    toc: toc,
                    metadata: { title, author, date },
                    config: settings
                }
            });
            this._hasPendingRender = false;
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js'));
        const katexCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'katex.css'));
        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: https:; script-src 'nonce-${nonce}' ${webview.cspSource}; style-src 'unsafe-inline' ${webview.cspSource} https://fonts.googleapis.com; font-src ${webview.cspSource} https://fonts.gstatic.com https:;">
                <link rel="preconnect" href="https://fonts.googleapis.com">
                <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
                <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500&family=Inter:wght@400;500;600&family=Merriweather:wght@400;700&family=Roboto:wght@400;500;700&display=swap">
                <link rel="stylesheet" href="${katexCssUri}">
                <title>Markdown Folio Preview</title>
            </head>
            <body>
                <div id="toolbar">
                    <button class="export-pill export-pdf-toggle" id="pdf-dropdown-toggle" title="Export PDF">Export PDF ▾</button>
                    <button class="export-pill" id="export-html" title="Export HTML">HTML</button>
                    <button class="export-pill export-pdf-toggle" id="png-dropdown-toggle" title="Export PNG">PNG ▾</button>
                    <button class="export-pill" id="export-docx" title="Export DOCX">DOCX</button>
                    <div class="toolbar-sep"></div>
                    <button class="toolbar-btn" id="settings-dropdown-toggle" title="Preview Settings">
                        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                        <span class="tb-label">Settings</span>
                    </button>
                    <div class="toolbar-sep"></div>
                    <div class="zoom-controls">
                        <button id="zoom-out" class="zoom-btn" title="Zoom out">-</button>
                        <span id="zoom-label">100%</span>
                        <button id="zoom-in" class="zoom-btn" title="Zoom in">+</button>
                    </div>
                    <div class="toolbar-sep"></div>
                    <button class="toolbar-btn" id="theme-toggle" title="Toggle theme">
                        <svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>
                        <span class="tb-label">Theme</span>
                    </button>
                </div>

                <div id="png-dropdown" class="dropdown-menu">
                    <div class="popover-group">
                        <button id="export-png-full" class="toolbar-btn">
                            <span class="tb-label">Full Page</span>
                            <span class="export-pdf-badge" style="font-size:10px;opacity:0.6">1 image</span>
                        </button>
                        <button id="export-png-pages" class="toolbar-btn">
                            <span class="tb-label">Per Page</span>
                            <span class="export-pdf-badge" style="font-size:10px;opacity:0.6">A4 pages</span>
                        </button>
                    </div>
                </div>

                <div id="pdf-dropdown" class="dropdown-menu">
                    <div class="popover-group">
                        <div class="pop-section-label">Orientation</div>
                        <div class="orient-row">
                            <button class="orient-btn active" data-orientation="portrait">Portrait</button>
                            <button class="orient-btn" data-orientation="landscape">Landscape</button>
                        </div>
                    </div>
                    <div class="popover-group">
                        <div class="pop-section-label">Paper Size</div>
                        <div class="size-row">
                            <button class="size-chip active" data-size="A4">A4</button>
                            <button class="size-chip" data-size="A3">A3</button>
                            <button class="size-chip" data-size="Letter">Letter</button>
                        </div>
                    </div>
                    <div class="popover-divider"></div>
                    <div class="popover-group">
                        <button id="export-pdf" class="toolbar-btn">
                            <span class="tb-label">Export PDF</span>
                            <span id="export-pdf-badge">A4 · Portrait</span>
                        </button>
                    </div>
                </div>

                <div id="settings-dropdown" class="dropdown-menu">
                    <div class="popover-group">
                        <div class="pop-section-label">Typography</div>
                        <div class="set-row">
                            <span class="set-row-label">Font</span>
                            <div class="set-chips">
                                <button class="set-chip" data-group="font">Georgia</button>
                                <button class="set-chip" data-group="font">Inter</button>
                                <button class="set-chip" data-group="font">Roboto</button>
                            </div>
                        </div>
                        <div class="set-row">
                            <span class="set-row-label">Size</span>
                            <div class="set-chips">
                                <button class="set-chip" data-group="font-size">S</button>
                                <button class="set-chip active" data-group="font-size">M</button>
                                <button class="set-chip" data-group="font-size">L</button>
                            </div>
                        </div>
                        <div class="set-row">
                            <span class="set-row-label">Heading</span>
                            <div class="set-chips">
                                <button class="set-chip" data-group="heading-size">S</button>
                                <button class="set-chip active" data-group="heading-size">M</button>
                                <button class="set-chip" data-group="heading-size">L</button>
                            </div>
                        </div>
                    </div>
                    <div class="popover-divider"></div>
                    <div class="popover-group">
                        <div class="pop-section-label">Layout</div>
                        <div class="set-row">
                            <span class="set-row-label">TOC Sidebar</span>
                            <span class="set-toggle on" data-action="toc-sidebar"></span>
                        </div>
                    </div>
                </div>

                <div class="workspace-shell">
                    <aside id="sidebar-toc"></aside>
                    <main id="document-container">
                        <div id="document-paper" class="width-standard">
                            <div id="document-content">Loading...</div>
                        </div>
                    </main>
                </div>

                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

