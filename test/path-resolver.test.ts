import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PathResolver } from '../src/utils/pathResolver';

/**
 * Phase 1 smoke tests for PathResolver.resolveImages.
 *
 * Tests target the public API (not the private _toDataUri). Phase 1 asserts
 * CURRENT behavior. Phase 2 (Security workstream) introduces the extension
 * allowlist and the absolute-path policy and updates these assertions in the
 * same commit.
 */
describe('PathResolver.resolveImages (current Phase 1 behavior)', () => {
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

    // PHASE-2 FIX TARGET: extension allowlist will reject this and leave the
    // markdown unchanged. Today the resolver still reads and embeds it.
    it('embeds a non-image extension (Phase 1: current bug; Phase 2 extension allowlist will reject)', () => {
        const md = '![txt](./notes.txt)';
        const out = PathResolver.resolveImages(md, fixturesDir);
        // Document current behavior: the file IS embedded with a non-image mime label.
        expect(out).toContain('data:image/txt;base64,');
    });

    // PHASE-2 FIX TARGET: extension allowlist will reject this too.
    it('embeds a .md file (Phase 1: current bug; Phase 2 extension allowlist will reject)', () => {
        const md = '![readme](./readme.md)';
        const out = PathResolver.resolveImages(md, fixturesDir);
        expect(out).toContain('data:image/md;base64,');
    });

    // PHASE-2 FIX TARGET: absolute-path policy will reject paths outside the
    // workspace. Today an absolute path to any readable file is embedded.
    it('embeds an absolute path outside documentDir (Phase 1: current bug; Phase 2 absolute-path policy will reject)', () => {
        const absolutePath = path.join(outsideDir, 'secret.txt');
        const md = `![leak](${absolutePath.replace(/\\/g, '/')})`;
        const out = PathResolver.resolveImages(md, fixturesDir);
        expect(out).toContain('data:image/txt;base64,');
    });

    it('leaves http:// URLs unchanged', () => {
        const md = '![cat](http://example.com/cat.png)';
        const out = PathResolver.resolveImages(md, fixturesDir);
        expect(out).toBe(md);
    });

    it('leaves https:// URLs unchanged', () => {
        const md = '![cat](https://example.com/cat.png)';
        const out = PathResolver.resolveImages(md, fixturesDir);
        expect(out).toBe(md);
    });

    it('leaves data: URLs unchanged', () => {
        const md = '![dot](data:image/png;base64,AAAA)';
        const out = PathResolver.resolveImages(md, fixturesDir);
        expect(out).toBe(md);
    });

    it('leaves the markdown unchanged when the file does not exist', () => {
        const md = '![missing](./does-not-exist.png)';
        const out = PathResolver.resolveImages(md, fixturesDir);
        expect(out).toBe(md);
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
});
