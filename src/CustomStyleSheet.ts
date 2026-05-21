import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const MAX_CUSTOM_STYLESHEET_SIZE = 256 * 1024;

export interface CustomStyleSheetResult {
    css: string;
    resolvedPath?: string;
    error?: string;
}

export class CustomStyleSheet {
    static load(configPath: string): CustomStyleSheetResult {
        const trimmed = configPath.trim();
        if (!trimmed) {
            return { css: '' };
        }

        const resolved = CustomStyleSheet.resolvePath(trimmed);
        if ('error' in resolved) {
            return { css: '', error: resolved.error };
        }

        try {
            const stat = fs.statSync(resolved.fsPath);
            if (!stat.isFile()) {
                return {
                    css: '',
                    resolvedPath: resolved.fsPath,
                    error: `Custom stylesheet path is not a file: ${resolved.fsPath}`,
                };
            }
            if (stat.size > MAX_CUSTOM_STYLESHEET_SIZE) {
                return {
                    css: '',
                    resolvedPath: resolved.fsPath,
                    error: `Custom stylesheet exceeds 256 KB: ${resolved.fsPath}`,
                };
            }

            return {
                css: fs.readFileSync(resolved.fsPath, 'utf-8'),
                resolvedPath: resolved.fsPath,
            };
        } catch (error: any) {
            const message = error?.message ? String(error.message) : 'Unknown error';
            return {
                css: '',
                resolvedPath: resolved.fsPath,
                error: `Failed to read custom stylesheet: ${message}`,
            };
        }
    }

    private static resolvePath(configPath: string): { fsPath: string } | { error: string } {
        if (path.isAbsolute(configPath)) {
            return { fsPath: path.normalize(configPath) };
        }

        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            return {
                error: `Relative custom stylesheet path requires an open workspace folder: ${configPath}`,
            };
        }

        return { fsPath: path.normalize(path.join(workspaceRoot, configPath)) };
    }
}
