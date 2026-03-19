import * as vscode from 'vscode';
import { PreviewPanel } from './PreviewPanel';
import { MarkdownFolioEditorProvider } from './MarkdownFolioEditorProvider';

export function activate(context: vscode.ExtensionContext) {
    const channel = vscode.window.createOutputChannel('Markdown Folio');
    channel.appendLine('Markdown Folio activating...');

    // Register as a custom editor — appears in "Select editor for *.md" dropdown
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

    context.subscriptions.push(openPreview);
    context.subscriptions.push(channel);
    channel.appendLine('Markdown Folio activated.');
}

export function deactivate() { }
