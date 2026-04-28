import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export class PasteImageHandler {
    public static async handlePasteImage() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('Markdown Folio: Open a markdown file first.');
            return;
        }

        const document = editor.document;
        if (document.languageId !== 'markdown') {
            vscode.window.showWarningMessage('Markdown Folio: Open a markdown file first.');
            return;
        }

        if (document.isUntitled) {
            vscode.window.showWarningMessage('Markdown Folio: Please save the file first before pasting images.');
            return;
        }

        if (document.uri.scheme !== 'file') {
            vscode.window.showWarningMessage('Markdown Folio: Paste image is only supported for local files.');
            return;
        }

        // Validate folder setting
        const config = vscode.workspace.getConfiguration('markdownFolio');
        let folderSetting = (config.get<string>('pasteImage.folder', 'assets') ?? 'assets').trim();
        if (!folderSetting) {
            folderSetting = 'assets';
        }

        if (path.isAbsolute(folderSetting)) {
            vscode.window.showWarningMessage('Markdown Folio: pasteImage.folder cannot be an absolute path.');
            return;
        }
        if (folderSetting.includes('..')) {
            vscode.window.showWarningMessage('Markdown Folio: pasteImage.folder cannot contain ".."');
            return;
        }

        const documentDir = path.dirname(document.uri.fsPath);
        const documentDirResolved = path.resolve(documentDir);
        const assetsDir = path.resolve(documentDir, folderSetting);

        // Make sure it doesn't escape the document directory unexpectedly.
        if (assetsDir !== documentDirResolved && !assetsDir.startsWith(documentDirResolved + path.sep)) {
            vscode.window.showWarningMessage('Markdown Folio: resolved assets path is invalid.');
            return;
        }

        const timestamp = Date.now();
        const filename = `image-${timestamp}.png`;
        const tempPath = path.join(os.tmpdir(), filename);
        const targetPath = path.join(assetsDir, filename);
        const linkPath = path.relative(documentDirResolved, targetPath).replace(/\\/g, '/');

        if (process.platform !== 'win32') {
            vscode.window.showErrorMessage('Markdown Folio: V1 of Paste Image only supports Windows.');
            return;
        }

        const script = `
            Add-Type -AssemblyName System.Windows.Forms
            if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
                $img = [System.Windows.Forms.Clipboard]::GetImage()
                $img.Save('${PasteImageHandler._escapePowerShellSingleQuotedString(tempPath)}', [System.Drawing.Imaging.ImageFormat]::Png)
                echo "OK"
            } else {
                echo "NO_IMAGE"
            }
        `;

        let targetCreated = false;
        try {
            const { stdout } = await execFileAsync('powershell', [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                script.replace(/\n/g, '; ')
            ]);
            const out = stdout.trim();
            if (out === 'NO_IMAGE') {
                vscode.window.showInformationMessage('Markdown Folio: No image found in clipboard.');
                return;
            } else if (out !== 'OK') {
                vscode.window.showErrorMessage(`Markdown Folio: Failed to read clipboard image. Output: ${out}`);
                return;
            }

            // Create assets dir
            await fs.promises.mkdir(assetsDir, { recursive: true });

            // Move temp file to target
            await fs.promises.copyFile(tempPath, targetPath);
            targetCreated = true;

            // Insert link into markdown
            const position = editor.selection.active;
            const snippet = `![](${linkPath})`;

            const success = await editor.edit(editBuilder => {
                editBuilder.insert(position, snippet);
            });

            if (!success) {
                // Cleanup
                await fs.promises.rm(targetPath, { force: true });
                targetCreated = false;
                vscode.window.showErrorMessage('Markdown Folio: Failed to insert image link.');
                return;
            }
            vscode.window.showInformationMessage(`Markdown Folio: Image pasted to ${linkPath}`);
        } catch (error: any) {
            if (targetCreated) {
                await fs.promises.rm(targetPath, { force: true }).catch(() => { });
            }
            vscode.window.showErrorMessage(`Markdown Folio: Paste image failed - ${error.message}`);
        } finally {
            // Cleanup temp
            try {
                if (fs.existsSync(tempPath)) {
                    await fs.promises.unlink(tempPath);
                }
            } catch (e) {
                // Ignore cleanup error
            }
        }
    }

    private static _escapePowerShellSingleQuotedString(value: string): string {
        return value.replace(/'/g, "''");
    }
}
