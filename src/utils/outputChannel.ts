import * as vscode from 'vscode';

/**
 * Lazy singleton accessor for the `Markdown Folio` output channel.
 *
 * Both `extension.ts` (activation logs) and `PreviewPanel.ts` (PathResolver
 * diagnostics; see 02-security-hardening §4.4) write to the same channel. The
 * extension host runs one Node process, so a module-level singleton is the
 * simplest plumbing — no `context`-passing chains required.
 */
let channel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
    if (!channel) {
        channel = vscode.window.createOutputChannel('Markdown Folio');
    }
    return channel;
}

/**
 * Test-only reset. Production code never calls this. Vitest does not import
 * `vscode` in this folder, so this is not exercised by tests today, but the
 * symbol exists so a future test can clean up the singleton between cases.
 */
export function _resetOutputChannelForTests(): void {
    channel = undefined;
}
