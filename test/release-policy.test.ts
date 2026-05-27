import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Phase 3 release-policy guards (plan 03-regression §3.6).
 *
 * These assertions read source files as raw text. They encode policies that
 * no behavioral test will reliably catch — a future maintainer could quietly
 * re-introduce `--no-sandbox` or revert `getNonce` to `Math.random` and every
 * other test in the suite would still pass.
 *
 * Source-text assertions are unusual but appropriate for release-contract
 * properties. Each banned substring traces back to an audit finding:
 *   - `--no-sandbox` / `--disable-setuid-sandbox`: audit 03 #1.
 *   - `Math.random` inside the nonce function: audit 04 NEW (predictability).
 */

const repoRoot = path.resolve(__dirname, '..');

function readSource(relativePath: string): string {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf-8');
}

describe('release-policy — sandbox flags absent from Chromium launch sites', () => {
    const launchSites = [
        'src/PdfExporter.ts',
        'src/PngExporter.ts',
        'src/utils/BrowserRasterizer.ts',
    ];

    for (const site of launchSites) {
        it(`${site} does not pass --no-sandbox`, () => {
            const src = readSource(site);
            expect(src).not.toContain('--no-sandbox');
        });

        it(`${site} does not pass --disable-setuid-sandbox`, () => {
            const src = readSource(site);
            expect(src).not.toContain('--disable-setuid-sandbox');
        });
    }
});

describe('release-policy — webview nonce uses cryptographic randomness', () => {
    it('src/PreviewPanel.ts has no Math.random call site', () => {
        const src = readSource('src/PreviewPanel.ts');
        // Match the call form `Math.random(` so the substring is permitted to
        // appear inside a JSDoc comment explaining why the call form is banned.
        expect(src).not.toMatch(/Math\.random\s*\(/);
    });

    it('src/PreviewPanel.ts imports node:crypto and the nonce function calls randomBytes', () => {
        const src = readSource('src/PreviewPanel.ts');
        expect(src).toMatch(/import \* as crypto from 'crypto'/);
        expect(src).toContain('crypto.randomBytes');
    });
});

describe('release-policy — sanitizer dependency is pinned exactly', () => {
    it('package.json does not float sanitize-html with ^ or ~', () => {
        const manifest = JSON.parse(readSource('package.json')) as {
            dependencies?: Record<string, string>;
        };
        expect(manifest.dependencies?.['sanitize-html']).toBe('2.17.4');
    });
});
