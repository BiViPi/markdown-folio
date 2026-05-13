import * as vscode from 'vscode';
import { PreviewPanel } from './PreviewPanel';
import { PasteImageHandler } from './PasteImageHandler';
import { MarkdownFolioEditorProvider } from './MarkdownFolioEditorProvider';

export function activate(context: vscode.ExtensionContext) {
    const channel = vscode.window.createOutputChannel('Markdown Folio');
    channel.appendLine('Markdown Folio activating...');

    // Register as a custom editor — appears in "Select editor for *.md" dropdown
    context.subscriptions.push(
        vscode.commands.registerCommand('markdownFolio.pasteImage', () => {
            PasteImageHandler.handlePasteImage();
        })
    );

    context.subscriptions.push(MarkdownFolioEditorProvider.register(context));

    const openPreview = vscode.commands.registerCommand('markdownFolio.openPreview', async (uri?: vscode.Uri) => {
        channel.appendLine('markdownFolio.openPreview invoked');
        const resource = uri || vscode.window.activeTextEditor?.document.uri;

        if (resource && resource.scheme === 'file' && resource.path.endsWith('.md')) {
            const document = await vscode.workspace.openTextDocument(resource);
            PreviewPanel.createOrShow(context, document);
            channel.appendLine(`Opened preview for ${resource.fsPath}`);
        } else {
            vscode.window.showErrorMessage('Markdown Folio: Active editor must be a Markdown file.');
            channel.appendLine('Open preview failed: active editor is not a Markdown file.');
        }
    });

    context.subscriptions.push(
        openPreview,
        vscode.commands.registerCommand('markdownFolio.exportPdf', async () => {
            await PreviewPanel.runExportCommand(context, 'pdf');
        }),
        vscode.commands.registerCommand('markdownFolio.exportHtml', async () => {
            await PreviewPanel.runExportCommand(context, 'html');
        }),
        vscode.commands.registerCommand('markdownFolio.exportDocx', async () => {
            await PreviewPanel.runExportCommand(context, 'docx');
        }),
        vscode.commands.registerCommand('markdownFolio.exportPngFull', async () => {
            await PreviewPanel.runExportCommand(context, 'png-full');
        }),
        vscode.commands.registerCommand('markdownFolio.exportPngPages', async () => {
            await PreviewPanel.runExportCommand(context, 'png-pages');
        })
    );

    // Status bar button — one-click access to preview for markdown files
    const statusBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 1000);
    statusBtn.text = '$(book) Folio';
    statusBtn.tooltip = 'Open Markdown Folio Preview';
    statusBtn.command = 'markdownFolio.openPreview';
    context.subscriptions.push(statusBtn);

    function updateStatusBar() {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'markdown') {
            statusBtn.show();
        } else {
            statusBtn.hide();
        }
    }
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatusBar));
    updateStatusBar();

    context.subscriptions.push(channel);
    channel.appendLine('Markdown Folio activated.');
}

export function deactivate() { }
