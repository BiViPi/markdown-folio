import * as vscode from 'vscode';
import { PreviewPanel } from './PreviewPanel';

/**
 * Registers Markdown Folio as a CustomTextEditor so it appears in the
 * "Select editor for *.md" dropdown and can be set as the default editor.
 *
 * When opened via this provider, the same PreviewPanel webview is used —
 * no duplication of logic.
 */
export class MarkdownFolioEditorProvider implements vscode.CustomTextEditorProvider {

    public static readonly viewType = 'markdownFolio.customEditor';

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new MarkdownFolioEditorProvider(context);
        return vscode.window.registerCustomEditorProvider(
            MarkdownFolioEditorProvider.viewType,
            provider,
            {
                webviewOptions: { retainContextWhenHidden: true },
                supportsMultipleEditorsPerDocument: false
            }
        );
    }

    constructor(private readonly context: vscode.ExtensionContext) {}

    /**
     * Called by VS Code when the user opens a .md file with Markdown Folio.
     * We delegate entirely to PreviewPanel, which already owns the webview logic.
     * The `webviewPanel` provided here replaces PreviewPanel's own panel creation.
     */
    async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        PreviewPanel.createFromExternalPanel(this.context, document, webviewPanel);
    }
}
