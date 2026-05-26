import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { MarkdownEngine } from './engine/MarkdownEngine';
import { sanitizeRenderedHtml } from './engine/sanitizer';
import { PathResolver, type BlockedImage } from './utils/pathResolver';
import { getOutputChannel } from './utils/outputChannel';
import { FrontmatterParser } from './engine/FrontmatterParser';
import { TocGenerator } from './engine/TocGenerator';
import { debounce } from './utils/debounce';
import { SettingsManager } from './SettingsManager';
import { PdfExporter } from './PdfExporter';
import { HtmlBuilder } from './HtmlBuilder';
import { HtmlExporter } from './HtmlExporter';
import { PngExporter } from './PngExporter';
import { DocxExporter } from './DocxExporter';
import { TikzRenderer } from './engine/TikzRenderer';
import { DocumentStats, type DocumentStats as DocumentStatsType } from './engine/DocumentStats';
import { CustomStyleSheet } from './CustomStyleSheet';

export class PreviewPanel {
    private static readonly _toolbarCollapsedStateKey = 'markdownFolio.toolbarCollapsed';
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
    private _scrollEventCounter = 0;
    private _scrollThrottleTimer: NodeJS.Timeout | null = null;
    private _pendingScrollLine = 0;
    private _mode: 'side' | 'customEditor' = 'side';
    private _suppressForwardScrollUntil = 0;
    private _toolbarCollapsed: boolean;
    private _tikzReadyWaiters: Array<() => void> = [];
    private _customStyleWatcher: vscode.FileSystemWatcher | undefined;
    private _customStyleWarningKey = '';
    // Dedupe key for PathResolver diagnostics warnings (02-security-hardening §4.4).
    // Identical blocked-image sets across renders should warn at most once.
    private _lastBlockedImagesKey = '';
    // Generation counter for TikZ async render guard (D6).
    // Incremented every _update() call; async results are discarded if stale.
    private _renderGeneration = 0;

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
            localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')]
        };
        const instance = new PreviewPanel(panel, context, document);
        instance._mode = 'customEditor';
        return instance;
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

        PreviewPanel.currentPanel = new PreviewPanel(panel, context, document);
    }

    public static async runExportCommand(
        context: vscode.ExtensionContext,
        kind: 'pdf' | 'html' | 'docx' | 'png-full' | 'png-pages'
    ): Promise<void> {
        const activeDocument = vscode.window.activeTextEditor?.document;
        const commandDocument = activeDocument?.uri.scheme === 'file' && activeDocument.fileName.toLowerCase().endsWith('.md')
            ? activeDocument
            : PreviewPanel.currentPanel?._document;

        if (!commandDocument) {
            vscode.window.showErrorMessage('Markdown Folio: Active editor must be a Markdown file.');
            return;
        }

        PreviewPanel.createOrShow(context, commandDocument);
        const panel = PreviewPanel.currentPanel;
        if (!panel) {
            vscode.window.showErrorMessage('Markdown Folio: Failed to open preview for export.');
            return;
        }

        switch (kind) {
            case 'pdf':
                await panel._handleExportPdf('portrait', 'A4');
                return;
            case 'html':
                await panel._handleExportHtml();
                return;
            case 'docx':
                await panel._handleExportDocx();
                return;
            case 'png-full':
                await panel._handleExportPng('full');
                return;
            case 'png-pages':
                await panel._handleExportPng('pages');
                return;
        }
    }

    private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext, document: vscode.TextDocument) {
        this._panel = panel;
        this._extensionUri = context.extensionUri;
        this._document = document;
        this._toolbarCollapsed = context.workspaceState.get<boolean>(PreviewPanel._toolbarCollapsedStateKey, false);

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

        // Forward scroll sync: editor visible range → preview
        this._disposables.push(
            vscode.window.onDidChangeTextEditorVisibleRanges(e => {
                if (e.textEditor.document !== this._document) { return; }
                if (!this._panel.visible) { return; }
                if (!SettingsManager.read().scrollSync) { return; }
                if (Date.now() < this._suppressForwardScrollUntil) { return; }
                this._pendingScrollLine = e.textEditor.visibleRanges[0]?.start.line ?? 0;
                // Throttle at ~50ms, but always send the latest observed line.
                if (this._scrollThrottleTimer) { return; }
                this._scrollThrottleTimer = setTimeout(() => {
                    this._scrollThrottleTimer = null;
                    this._panel.webview.postMessage({
                        type: 'scroll-to-line',
                        payload: { line: this._pendingScrollLine, eventId: ++this._scrollEventCounter }
                    });
                }, 50);
            })
        );

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
                    case 'toolbar-collapsed-changed':
                        this._toolbarCollapsed = !!message.payload?.collapsed;
                        context.workspaceState.update(
                            PreviewPanel._toolbarCollapsedStateKey,
                            this._toolbarCollapsed
                        ).then(undefined, err => {
                            vscode.window.showErrorMessage(`Markdown Folio: Failed to persist toolbar state: ${err}`);
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
                        this._handleExportHtml();
                        return;
                    }
                    case 'export-png-full':
                        this._handleExportPng('full');
                        return;
                    case 'export-png-pages':
                        this._handleExportPng('pages');
                        return;
                    case 'copy': {
                        const payload = message.payload;
                        this._handleCopy(payload);
                        return;
                    }
                    case 'export-docx':
                        this._handleExportDocx();
                        return;
                    case 'reveal-line': {
                        this._handleRevealLine(message.payload);
                        return;
                    }
                }
            },
            null,
            this._disposables
        );

        // Listen for VS Code settings changes → push to webview immediately
        this._disposables.push(
            SettingsManager.onDidChange(settings => {
                this._refreshCustomStyleWatcher(settings);
                this._hasPendingRender = true;
                if (this._panel.visible) {
                    this._update();
                }
            })
        );
        this._refreshCustomStyleWatcher(SettingsManager.read());
    }

    public dispose() {
        PreviewPanel.currentPanel = undefined;

        // Clean up our resources
        if (this._scrollThrottleTimer) {
            clearTimeout(this._scrollThrottleTimer);
            this._scrollThrottleTimer = null;
        }
        this._customStyleWatcher?.dispose();
        this._customStyleWatcher = undefined;
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
            vscode.window.showWarningMessage('Markdown Folio: No content to export. Please open a Markdown file first.');
            return false;
        }
        return true;
    }

    /**
     * If TikZ is still rendering (pending placeholders in _lastRenderedHtml),
     * warn the user and let them choose to export now or wait.
     * Returns true if the export should proceed.
     */
    private async _guardTikzReady(): Promise<boolean> {
        if (!this._hasPendingTikzRender()) {
            return true;
        }
        const choice = await vscode.window.showWarningMessage(
            'Markdown Folio: TikZ diagrams are still rendering. The exported document may contain placeholder boxes.',
            'Export Now',
            'Wait'
        );
        if (choice === 'Export Now') {
            return true;
        }
        if (choice === 'Wait') {
            await this._waitForTikzReady();
            return true;
        }
        return false;
    }

    private _handleRevealLine(payload: { line: number; eventId?: number }): void {
        // Custom editor mode: never auto-open text editor
        if (this._mode === 'customEditor') { return; }
        // Respect scrollSync setting
        if (!SettingsManager.read().scrollSync) { return; }
        // Only reveal if a visible text editor is already showing this document
        const editor = vscode.window.visibleTextEditors.find(e => e.document === this._document);
        if (!editor) { return; }
        const line = payload.line ?? 0;
        if (this._scrollThrottleTimer) {
            clearTimeout(this._scrollThrottleTimer);
            this._scrollThrottleTimer = null;
        }
        this._suppressForwardScrollUntil = Date.now() + 500;
        editor.revealRange(
            new vscode.Range(line, 0, line, 0),
            vscode.TextEditorRevealType.AtTop
        );
    }

    private async _handleExportPdf(
        orientation: 'portrait' | 'landscape',
        size: 'A4' | 'A3' | 'Letter'
    ): Promise<void> {
        if (!this._guardContent()) { return; }
        if (!await this._guardTikzReady()) { return; }
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
            const customStyle = this._loadCustomStyleSheet(settings.customStyleSheet);
            const pdfHtml = HtmlBuilder.buildPdfHtml({
                html: this._lastRenderedHtml,
                distDir,
                settings,
                customStyleSheetCss: customStyle.css,
                title: this._lastTitle,
            });

            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: 'Markdown Folio: Exporting PDF...',
                    cancellable: false,
                },
                async () => {
                    await PdfExporter.export(pdfHtml, {
                        orientation,
                        size,
                        outputPath: saveUri.fsPath,
                        headings: this._lastToc.filter(h => h.level <= 3),
                        chromePath: settings.chromePath,
                    });
                }
            );

            const open = await vscode.window.showInformationMessage(
                `PDF exported: ${path.basename(saveUri.fsPath)}`,
                'Open file'
            );
            if (open === 'Open file') {
                vscode.env.openExternal(saveUri);
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Markdown Folio: PDF export failed — ${err.message}`);
        }
    }

    private async _handleCopy(payload: any) {
        if (!this._guardContent()) return;
        try {
            if (payload.mode === 'notion-markdown') {
                const markdown = this._buildNotionMarkdownSource();
                await vscode.env.clipboard.writeText(markdown);
                vscode.window.showInformationMessage('Markdown copied for Notion');
            } else if (payload.mode === 'rich-html-fallback') {
                const text = payload.html || payload.text || '';
                await vscode.env.clipboard.writeText(text);
                vscode.window.showInformationMessage('Copied (Fallback Text/HTML)');
            } else if (payload.mode === 'plain-text-fallback') {
                await vscode.env.clipboard.writeText(payload.text || '');
                vscode.window.showInformationMessage('Copied (Plain Text)');
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Markdown Folio: Copy failed - ${err.message}`);
        }
    }

    private _buildNotionMarkdownSource(): string {
        let text = this._document.getText();
        // Normalize CRLF to LF
        text = text.replace(/\r\n/g, '\n');
        // Remove YAML frontmatter if it starts at the top
        text = text.replace(/^---\n[\s\S]*?\n---\n?/, '');
        // Trim leading/trailing blank lines
        return text.trim();
    }

    private async _handleExportHtml(): Promise<void> {
        if (!this._guardContent()) { return; }
        if (!await this._guardTikzReady()) { return; }
        try {
            const defaultName = path.basename(this._document.fileName, '.md') + '.html';
            const saveUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(path.join(path.dirname(this._document.fileName), defaultName)),
                filters: { 'HTML Files': ['html'] },
            });
            if (!saveUri) { return; }

            const distDir = path.join(this._extensionUri.fsPath, 'dist');
            const settings = SettingsManager.read();
            const customStyle = this._loadCustomStyleSheet(settings.customStyleSheet);
            const exportHtml = HtmlBuilder.buildExportHtml({
                html: this._lastRenderedHtml,
                distDir,
                settings,
                customStyleSheetCss: customStyle.css,
                title: this._lastTitle,
                toc: this._lastToc,
            });

            await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Markdown Folio: Exporting HTML...', cancellable: false },
                async () => { HtmlExporter.export(exportHtml, saveUri.fsPath); }
            );

            const open = await vscode.window.showInformationMessage(
                `HTML exported: ${path.basename(saveUri.fsPath)}`, 'Open file'
            );
            if (open === 'Open file') { vscode.env.openExternal(saveUri); }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Markdown Folio: HTML export failed — ${err.message}`);
        }
    }

    private async _handleExportPng(mode: 'full' | 'pages'): Promise<void> {
        if (!this._guardContent()) { return; }
        if (!await this._guardTikzReady()) { return; }
        try {
            const baseName = path.basename(this._document.fileName, '.md');
            const distDir = path.join(this._extensionUri.fsPath, 'dist');
            const settings = SettingsManager.read();
            const customStyle = this._loadCustomStyleSheet(settings.customStyleSheet);
            const pngHtml = HtmlBuilder.buildExportHtml({
                html: this._lastRenderedHtml,
                distDir,
                settings,
                customStyleSheetCss: customStyle.css,
                title: this._lastTitle,
                toc: this._lastToc,
            });

            if (mode === 'full') {
                const saveUri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(path.join(path.dirname(this._document.fileName), `${baseName}.png`)),
                    filters: { 'PNG Image': ['png'] },
                });
                if (!saveUri) { return; }

                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: 'Markdown Folio: Exporting PNG...', cancellable: false },
                    async () => {
                        await PngExporter.export(pngHtml, {
                            outputPath: saveUri.fsPath,
                            mode: 'full',
                            chromePath: settings.chromePath,
                        });
                    }
                );
                const open = await vscode.window.showInformationMessage(
                    `PNG exported: ${path.basename(saveUri.fsPath)}`, 'Open file'
                );
                if (open === 'Open file') { vscode.env.openExternal(saveUri); }
            } else {
                // Pages mode: chọn folder
                const folderUri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(path.join(path.dirname(this._document.fileName), `${baseName}-pages`)),
                    filters: { 'Folder name (no extension)': [''] },
                    title: 'Select output folder for PNG pages',
                });
                if (!folderUri) { return; }

                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: 'Markdown Folio: Exporting PNG pages...', cancellable: false },
                    async () => {
                        await PngExporter.export(pngHtml, {
                            outputPath: folderUri.fsPath,
                            mode: 'pages',
                            chromePath: settings.chromePath,
                        });
                    }
                );
                const open = await vscode.window.showInformationMessage(
                    `PNG pages exported to: ${path.basename(folderUri.fsPath)}`, 'Open folder'
                );
                if (open === 'Open folder') { vscode.env.openExternal(folderUri); }
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Markdown Folio: PNG export failed — ${err.message}`);
        }
    }

    private async _handleExportDocx(): Promise<void> {
        if (!this._guardContent()) { return; }
        if (!await this._guardTikzReady()) { return; }
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
                { location: vscode.ProgressLocation.Notification, title: 'Markdown Folio: Exporting DOCX...', cancellable: false },
                async () => {
                    await DocxExporter.export(this._lastRenderedHtml, {
                        outputPath: saveUri.fsPath,
                        title: this._lastTitle,
                        distDir,
                        settings,
                        chromePath: settings.chromePath,
                    });
                }
            );

            const open = await vscode.window.showInformationMessage(
                `DOCX exported: ${path.basename(saveUri.fsPath)}`, 'Open file'
            );
            if (open === 'Open file') { vscode.env.openExternal(saveUri); }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Markdown Folio: DOCX export failed — ${err.message}`);
        }
    }

    private _update() {
        const webview = this._panel.webview;
        const settings = SettingsManager.read();
        const darkMode = !['ivory', 'serene', 'github'].includes(settings.theme);

        const documentContent = this._document.getText();
        const documentDir = path.dirname(this._document.fileName);

        const { title, author, date, content, lineOffset } = FrontmatterParser.extract(documentContent);
        const resolvedImages = PathResolver.resolveImagesWithDiagnostics(content, documentDir);
        this._reportBlockedImages(resolvedImages.diagnostics);
        const toc = TocGenerator.extract(content);
        const stats = DocumentStats.compute(content);

        const rawHtml = PreviewPanel._markdownEngine.render(resolvedImages.markdown, lineOffset);
        const gen = ++this._renderGeneration;

        this._lastToc = toc;
        this._lastTitle = title || path.basename(this._document.fileName, '.md');

        // Update panel title
        this._panel.title = `Preview: ${title || path.basename(this._document.fileName)}`;

        if (!this._htmlInitialized) {
            this._panel.webview.html = this._getHtmlForWebview(webview);
            this._htmlInitialized = true;
        }

        // Keep non-TikZ documents on the synchronous preview path.
        if (!rawHtml.includes('tikz-pending')) {
            const sanitized = sanitizeRenderedHtml(rawHtml);
            this._lastRenderedHtml = sanitized;
            this._sendRender(sanitized, toc, stats, title, author, date);
            return;
        }

        // TikZ two-phase render (plan §3.1.6):
        // Phase 1 — synchronous: resolve cache hits instantly, send to webview immediately.
        // Phase 2 — async: resolve cache misses in the background, re-send when done.
        // Sanitize the resolved HTML (after TikZ placeholder substitution) per
        // 02-security-hardening §3.2.3 — sanitizer runs on the resolved tree so
        // it can see the inline SVG markup and apply the same allowlist.
        const phase1Html = sanitizeRenderedHtml(TikzRenderer.resolveCacheHits(rawHtml, darkMode));
        this._lastRenderedHtml = phase1Html;
        this._sendRender(phase1Html, toc, stats, title, author, date);

        // Fire async resolution only if there are still unresolved placeholders.
        if (phase1Html.includes('tikz-loading')) {
            this._resolveTikzAsync(rawHtml, gen, toc, stats, title, author, date, darkMode);
        }
    }

    private async _resolveTikzAsync(
        rawHtml: string,
        gen: number,
        toc: import('./shared/types').TocItem[],
        stats: DocumentStatsType,
        title: string | undefined,
        author: string | undefined,
        date: string | undefined,
        darkMode: boolean
    ): Promise<void> {
        try {
            const resolvedHtml = await TikzRenderer.resolveAll(rawHtml, darkMode);
            if (this._renderGeneration !== gen) { return; } // document changed while rendering
            const sanitized = sanitizeRenderedHtml(resolvedHtml);
            this._lastRenderedHtml = sanitized;
            this._sendRender(sanitized, toc, stats, title, author, date);
        } catch {
            // Individual block errors are already encoded inside resolveAll().
            // Nothing to propagate here.
        }
    }

    /** Send the rendered HTML to the webview. Extracted to avoid duplication. */
    private _sendRender(
        html: string,
        toc: import('./shared/types').TocItem[],
        stats: DocumentStatsType,
        title: string | undefined,
        author: string | undefined,
        date: string | undefined
    ): void {
        if (this._panel.visible && this._webviewReady) {
            const settings = SettingsManager.read();
            const customStyle = this._loadCustomStyleSheet(settings.customStyleSheet);
            this._panel.webview.postMessage({
                type: 'render',
                payload: {
                    html,
                    toc,
                    stats,
                    metadata: { title, author, date },
                    config: {
                        ...settings,
                        customStyleSheetCss: customStyle.css,
                        toolbarCollapsed: this._toolbarCollapsed
                    }
                }
            });
            this._hasPendingRender = false;
            this._flushTikzReadyWaitersIfSettled(html);
        }
    }

    private _hasPendingTikzRender(html: string = this._lastRenderedHtml): boolean {
        return html.includes('tikz-pending') || html.includes('tikz-loading');
    }

    private _waitForTikzReady(): Promise<void> {
        if (!this._hasPendingTikzRender()) {
            return Promise.resolve();
        }
        return new Promise(resolve => {
            this._tikzReadyWaiters.push(resolve);
        });
    }

    private _flushTikzReadyWaitersIfSettled(html: string): void {
        if (this._hasPendingTikzRender(html) || this._tikzReadyWaiters.length === 0) {
            return;
        }
        const waiters = this._tikzReadyWaiters.splice(0);
        for (const resolve of waiters) {
            resolve();
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js'));
        const katexCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'katex.css'));
        const tikzJaxFontsCssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'dist', 'vendor', 'node-tikzjax', 'css', 'fonts.css'));
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
                <link rel="stylesheet" href="${tikzJaxFontsCssUri}">
                <title>Markdown Folio Preview</title>
            </head>
            <body>
                <div id="toolbar">
                    <button class="export-pill export-pdf-toggle" id="pdf-dropdown-toggle" title="Export PDF">
                        Export PDF <svg class="dropdown-icon" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <button class="export-pill" id="export-html" title="Export HTML">HTML</button>
                    <button class="export-pill export-pdf-toggle" id="copy-dropdown-toggle" title="Copy">
                        Copy <svg class="dropdown-icon" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <button class="export-pill export-pdf-toggle" id="png-dropdown-toggle" title="Export PNG">
                        PNG <svg class="dropdown-icon" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
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
                    <button class="toolbar-btn" id="theme-dropdown-toggle" title="Preview Theme">
                        <span class="tb-label" id="theme-label">Theme</span>
                        <svg class="dropdown-icon" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5" stroke="currentColor" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <div class="toolbar-sep"></div>
                    <button class="toolbar-btn" id="toolbar-toggle" title="Collapse Toolbar">
                        <svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" stroke-width="2" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                </div>

                <div id="copy-dropdown" class="dropdown-menu">
                    <div class="popover-group">
                        <button id="copy-rich-html" class="toolbar-btn"><span class="tb-label">Rich HTML</span></button>
                        <button id="copy-notion-markdown" class="toolbar-btn"><span class="tb-label">Notion Markdown</span></button>
                        <button id="copy-plain-text" class="toolbar-btn"><span class="tb-label">Plain Text</span></button>
                    </div>
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

                <div id="theme-dropdown" class="dropdown-menu">
                    <div class="popover-group">
                        <button class="toolbar-btn theme-btn" data-theme="admiral"><span class="tb-label">Admiral</span></button>
                        <button class="toolbar-btn theme-btn" data-theme="ivory"><span class="tb-label">Ivory</span></button>
                        <button class="toolbar-btn theme-btn" data-theme="serene"><span class="tb-label">Serene</span></button>
                        <button class="toolbar-btn theme-btn" data-theme="cyberpunk"><span class="tb-label">Cyberpunk</span></button>
                        <button class="toolbar-btn theme-btn" data-theme="dracula"><span class="tb-label">Dracula</span></button>
                        <button class="toolbar-btn theme-btn" data-theme="github"><span class="tb-label">GitHub</span></button>
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
                        <div class="set-row">
                            <span class="set-row-label">Line spacing</span>
                            <div class="set-chips">
                                <button class="set-chip" data-group="line-spacing" data-value="compact">Compact</button>
                                <button class="set-chip" data-group="line-spacing" data-value="normal">Normal</button>
                                <button class="set-chip" data-group="line-spacing" data-value="relaxed">Relaxed</button>
                            </div>
                        </div>
                    </div>
                    <div class="popover-divider"></div>
                    <div class="popover-group">
                        <div class="pop-section-label">Layout</div>
                        <div class="set-row">
                            <span class="set-row-label">Page width</span>
                            <div class="set-chips">
                                <button class="set-chip" data-group="page-width" data-value="narrow">Narrow</button>
                                <button class="set-chip" data-group="page-width" data-value="standard">Standard</button>
                                <button class="set-chip" data-group="page-width" data-value="wide">Wide</button>
                            </div>
                        </div>
                        <div class="set-row">
                            <span class="set-row-label">TOC Sidebar</span>
                            <span class="set-toggle on" data-action="toc-sidebar"></span>
                        </div>
                        <div class="set-row">
                            <span class="set-row-label">Page guides</span>
                            <span class="set-toggle" data-action="print-margins"></span>
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

    private _refreshCustomStyleWatcher(settings: import('./SettingsManager').PreviewSettings): void {
        this._customStyleWatcher?.dispose();
        this._customStyleWatcher = undefined;

        const result = CustomStyleSheet.load(settings.customStyleSheet);
        if (!result.resolvedPath) {
            return;
        }

        const pattern = new vscode.RelativePattern(path.dirname(result.resolvedPath), path.basename(result.resolvedPath));
        this._customStyleWatcher = vscode.workspace.createFileSystemWatcher(pattern);
        const onChange = () => {
            this._hasPendingRender = true;
            if (this._panel.visible) {
                this._update();
            }
        };
        this._customStyleWatcher.onDidChange(onChange, null, this._disposables);
        this._customStyleWatcher.onDidCreate(onChange, null, this._disposables);
        this._customStyleWatcher.onDidDelete(onChange, null, this._disposables);
    }

    private _loadCustomStyleSheet(configPath: string): { css: string } {
        const result = CustomStyleSheet.load(configPath);
        if (result.error) {
            const warningKey = `${result.resolvedPath || configPath}::${result.error}`;
            if (warningKey !== this._customStyleWarningKey) {
                this._customStyleWarningKey = warningKey;
                vscode.window.showWarningMessage(`Markdown Folio: ${result.error}`);
            }
            return { css: '' };
        }

        this._customStyleWarningKey = '';
        return { css: result.css };
    }

    /**
     * Surfaces PathResolver-blocked image paths (02-security-hardening §4.4):
     *   - One toast warning per render pass when the blocked set changes.
     *   - Always log each blocked source to the output channel so the user can
     *     see the exact paths after dismissing the toast.
     */
    private _reportBlockedImages(blocked: BlockedImage[]): void {
        if (blocked.length === 0) {
            this._lastBlockedImagesKey = '';
            return;
        }

        const key = blocked
            .map(b => `${b.reason}:${b.source}`)
            .sort()
            .join('|');
        if (key === this._lastBlockedImagesKey) {
            return;
        }
        this._lastBlockedImagesKey = key;

        const channel = getOutputChannel();
        for (const b of blocked) {
            channel.appendLine(`PathResolver blocked: [${b.reason}] ${b.source}`);
        }

        vscode.window.showWarningMessage(
            `Markdown Folio: ${blocked.length} image(s) skipped (absolute paths or unsupported extensions). See output channel for details.`
        );
    }
}

function getNonce(): string {
    // 24 bytes → 32 base64 characters. Cryptographically random per
    // 02-security-hardening §6 item 9. Math.random is unacceptable for any
    // value that gates script execution, even when the immediate exploit path
    // is unclear.
    return crypto.randomBytes(24).toString('base64');
}
