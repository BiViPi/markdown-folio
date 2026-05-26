import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PathResolver } from '../src/utils/pathResolver';

/**
 * Phase 3 PathResolver tests (02-security-hardening §4).
 *
 * Coverage after Phase 3:
 *   - Extension allowlist enforced (jpg/jpeg/png/gif/svg/webp).
 *   - Absolute-path Policy A: absolute paths are rejected.
 *   - Diagnostics shape: additive optional collector array of BlockedImage.
 *   - Existing remote/data/non-existent paths still pass through unchanged.
 */
describe('PathResolver.resolveImages', () => {
    let fixturesDir: string;
    let outsideDir: string;

    const minimalPngBytes = Buffer.from('89504e470d0a1a0a', 'hex');

    beforeAll(() => {
        fixturesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-pathresolver-test-'));
        outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-pathresolver-outside-'));

        fs.writeFileSync(path.join(fixturesDir, 'ok.png'), minimalPngBytes);
        fs.writeFileSync(path.join(fixturesDir, 'notes.txt'), 'plain text');
        fs.writeFileSync(path.join(fixturesDir, 'readme.md'), '# fixture');
        fs.writeFileSync(path.join(outsideDir, 'secret.txt'), 'secret data');
    });

    afterAll(() => {
        fs.rmSync(fixturesDir, { recursive: true, force: true });
        fs.rmSync(outsideDir, { recursive: true, force: true });
    });

    it('embeds a relative .png as data:image/png;base64', () => {
        const md = '![logo](./ok.png)';
        const out = PathResolver.resolveImages(md, fixturesDir);
        expect(out).toContain('data:image/png;base64,');
        expect(out).toContain('alt="logo"');
    });

    it('rejects a non-image extension and reports it in diagnostics', () => {
        const md = '![txt](./notes.txt)';
        const result = PathResolver.resolveImagesWithDiagnostics(md, fixturesDir);
        expect(result.markdown).toBe(md);
        expect(result.markdown).not.toContain('data:image/txt');
        expect(result.diagnostics).toEqual([{ source: './notes.txt', reason: 'extension-blocked' }]);
    });

    it('rejects a .md image target and reports it in diagnostics', () => {
        const md = '![readme](./readme.md)';
        const result = PathResolver.resolveImagesWithDiagnostics(md, fixturesDir);
        expect(result.markdown).toBe(md);
        expect(result.diagnostics).toEqual([{ source: './readme.md', reason: 'extension-blocked' }]);
    });

    it('rejects an absolute path outside documentDir and reports absolute-rejected', () => {
        const absolutePath = path.join(outsideDir, 'secret.txt').replace(/\\/g, '/');
        const md = `![leak](${absolutePath})`;
        const result = PathResolver.resolveImagesWithDiagnostics(md, fixturesDir);
        expect(result.markdown).toBe(md);
        expect(result.markdown).not.toContain('data:image/');
        // Even though the extension is .txt (also blocked), absolute-path policy
        // fires first so the reason is the more informative absolute-rejected.
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]).toMatchObject({ reason: 'absolute-rejected' });
    });

    it('rejects an absolute path even when the extension is allowed (Policy A)', () => {
        // Build an absolute path that looks like a valid image. Even though it
        // would be a legitimate-looking PNG, Policy A rejects the whole class.
        const absoluteLike = process.platform === 'win32'
            ? 'C:/temp/whatever.png'
            : '/tmp/whatever.png';
        const md = `![abs](${absoluteLike})`;
        const result = PathResolver.resolveImagesWithDiagnostics(md, fixturesDir);
        expect(result.markdown).toBe(md);
        expect(result.diagnostics).toEqual([{ source: absoluteLike, reason: 'absolute-rejected' }]);
    });

    it('reports not-found for an allowed-extension path that does not exist', () => {
        const md = '![missing](./does-not-exist.png)';
        const result = PathResolver.resolveImagesWithDiagnostics(md, fixturesDir);
        expect(result.markdown).toBe(md);
        expect(result.diagnostics).toEqual([{ source: './does-not-exist.png', reason: 'not-found' }]);
    });

    it('leaves http:// URLs unchanged with no diagnostics entry', () => {
        const md = '![cat](http://example.com/cat.png)';
        const result = PathResolver.resolveImagesWithDiagnostics(md, fixturesDir);
        expect(result.markdown).toBe(md);
        expect(result.diagnostics).toHaveLength(0);
    });

    it('leaves https:// URLs unchanged with no diagnostics entry', () => {
        const md = '![cat](https://example.com/cat.png)';
        const result = PathResolver.resolveImagesWithDiagnostics(md, fixturesDir);
        expect(result.markdown).toBe(md);
        expect(result.diagnostics).toHaveLength(0);
    });

    it('leaves data: URLs unchanged with no diagnostics entry', () => {
        const md = '![dot](data:image/png;base64,AAAA)';
        const result = PathResolver.resolveImagesWithDiagnostics(md, fixturesDir);
        expect(result.markdown).toBe(md);
        expect(result.diagnostics).toHaveLength(0);
    });

    it('rewrites <img src="..."> tags with relative local paths', () => {
        const md = '<img src="./ok.png" alt="raw">';
        const out = PathResolver.resolveImages(md, fixturesDir);
        expect(out).toContain('src="data:image/png;base64,');
        expect(out).toContain('alt="raw"');
    });

    it('escapes the alt attribute when embedding', () => {
        const md = '![<x&y>](./ok.png)';
        const out = PathResolver.resolveImages(md, fixturesDir);
        expect(out).toContain('alt="&lt;x&amp;y&gt;"');
    });

    it('aggregates multiple diagnostics from a single render pass in order', () => {
        const md = [
            '![a](./ok.png)',
            '![b](./notes.txt)',
            '![c](./readme.md)',
            '![d](./missing.png)',
        ].join('\n');
        const result = PathResolver.resolveImagesWithDiagnostics(md, fixturesDir);
        expect(result.markdown).toContain('data:image/png;base64,');
        expect(result.diagnostics.map(b => b.reason)).toEqual([
            'extension-blocked',
            'extension-blocked',
            'not-found',
        ]);
    });

    it('keeps resolveImages() as the string-returning compatibility wrapper', () => {
        const md = '![txt](./notes.txt)';
        const out = PathResolver.resolveImages(md, fixturesDir);
        expect(out).toBe(md);
    });
});
