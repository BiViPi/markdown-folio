import * as vscode from 'vscode';

export interface PreviewSettings {
    headingFont: string;
    bodyFont: string;
    fontSize: number;
    headingSize: 'S' | 'M' | 'L';
    lineSpacing: 'compact' | 'normal' | 'relaxed';
    pageWidth: 'narrow' | 'standard' | 'wide';
    showTocSidebar: boolean;
    theme: 'dark' | 'light' | 'sepia' | 'midnight' | 'auto';
}

const DEFAULTS: PreviewSettings = {
    headingFont: "'Merriweather', Georgia, serif",
    bodyFont: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
    fontSize: 16,
    headingSize: 'M',
    lineSpacing: 'normal',
    pageWidth: 'standard',
    showTocSidebar: true,
    theme: 'auto',
};

export class SettingsManager {
    private static readonly _section = 'markdownFolio';

    static read(): PreviewSettings {
        const cfg = vscode.workspace.getConfiguration(SettingsManager._section);
        return {
            headingFont: cfg.get<string>('headingFont', DEFAULTS.headingFont),
            bodyFont: cfg.get<string>('bodyFont', DEFAULTS.bodyFont),
            fontSize: cfg.get<number>('fontSize', DEFAULTS.fontSize),
            headingSize: cfg.get<'S' | 'M' | 'L'>('headingSize', DEFAULTS.headingSize),
            lineSpacing: cfg.get<'compact' | 'normal' | 'relaxed'>('lineSpacing', DEFAULTS.lineSpacing),
            pageWidth: cfg.get<'narrow' | 'standard' | 'wide'>('pageWidth', DEFAULTS.pageWidth),
            showTocSidebar: cfg.get<boolean>('showTocSidebar', DEFAULTS.showTocSidebar),
            theme: cfg.get<'dark' | 'light' | 'sepia' | 'midnight' | 'auto'>('theme', DEFAULTS.theme),
        };
    }

    static async update(partial: Partial<PreviewSettings>): Promise<void> {
        const cfg = vscode.workspace.getConfiguration(SettingsManager._section);
        const promises = Object.entries(partial).map(([key, value]) =>
            cfg.update(key, value, vscode.ConfigurationTarget.Global)
        );
        await Promise.all(promises);
    }

    static onDidChange(callback: (settings: PreviewSettings) => void): vscode.Disposable {
        return vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(SettingsManager._section)) {
                callback(SettingsManager.read());
            }
        });
    }
}
