import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';

export type TikzRenderResult =
    | { ok: true; svg: string }
    | { ok: false; error: string };

// ── Rejected commands (D15 + D14) ─────────────────────────────────────────
// These must not reach pdflatex. Checked before any subprocess is spawned.
const REJECTED_COMMANDS = [
    /\\usepackage\s*(\[.*?\])?\s*\{/,
    /\\input\s*\{/,
    /\\include\s*\{/,
    /\\includegraphics\s*(\[.*?\])?\s*\{/,
    /\\begin\s*\{document\}/,
];

// ── Default TikZ library set included in every generated preamble (D13) ───
const DEFAULT_LIBRARIES = 'calc,arrows.meta,shapes,positioning,decorations.pathmorphing';

// ── Serial async queue ─────────────────────────────────────────────────────
// One active pdflatex subprocess at a time per extension instance.
type QueuedTask = () => Promise<void>;
let _queue: QueuedTask[] = [];
let _running = false;

function enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        _queue.push(async () => {
            try { resolve(await task()); } catch (e) { reject(e); }
        });
        _drain();
    });
}

async function _drain(): Promise<void> {
    if (_running) { return; }
    const next = _queue.shift();
    if (!next) { return; }
    _running = true;
    try { await next(); } finally {
        _running = false;
        _drain();
    }
}

// ── Cache ─────────────────────────────────────────────────────────────────
const _cache = new Map<string, TikzRenderResult>();

function _cacheKey(source: string): string {
    return crypto.createHash('sha256').update(source).digest('hex');
}

// ── Availability ──────────────────────────────────────────────────────────
let _available: boolean | null = null;

function _checkBinary(cmd: string): Promise<boolean> {
    return new Promise(resolve => {
        const checker = process.platform === 'win32' ? 'where' : 'which';
        execFile(checker, [cmd], { timeout: 5000 }, (err) => resolve(!err));
    });
}

export class TikzRenderer {
    /** Check if pdflatex + dvisvgm are on PATH. Cached after first call. */
    static async isAvailable(): Promise<boolean> {
        if (_available !== null) { return _available; }
        const [hasPdflatex, hasDvisvgm] = await Promise.all([
            _checkBinary('pdflatex'),
            _checkBinary('dvisvgm'),
        ]);
        _available = hasPdflatex && hasDvisvgm;
        return _available;
    }

    /** Reset availability cache (for testing). */
    static resetAvailabilityCache(): void {
        _available = null;
    }

    /**
     * Parse user block content and build a complete .tex file string.
     * Applies the input contract from D14:
     *   (a) bare TikZ body → wrapped in tikzpicture
     *   (b) full \begin{tikzpicture}...\end{tikzpicture} → used as-is
     *   (c) \usetikzlibrary{} lines at top → extracted to preamble
     * Rejected commands (D15) produce an error result before any subprocess.
     */
    static _buildTexFile(source: string): { ok: true; tex: string } | { ok: false; error: string } {
        // Reject forbidden commands before touching LaTeX.
        for (const pattern of REJECTED_COMMANDS) {
            if (pattern.test(source)) {
                const matched = source.match(pattern)?.[0] ?? '';
                if (/\\usepackage/.test(matched)) {
                    return { ok: false, error: '\\usepackage{} is not supported in fenced tikz blocks.\nUse \\usetikzlibrary{} to load TikZ libraries.' };
                }
                if (/\\begin\s*\{document\}/.test(matched)) {
                    return { ok: false, error: 'Full LaTeX document syntax (\\begin{document}) is not supported.\nWrite only TikZ body content or a \\begin{tikzpicture}...\\end{tikzpicture} block.' };
                }
                // \input, \include, \includegraphics
                return { ok: false, error: `${matched.trim()} is not supported in fenced tikz blocks.\nExternal file references are disabled for security.` };
            }
        }

        // Extract leading \usetikzlibrary{...} lines.
        const lines = source.split('\n');
        const userLibLines: string[] = [];
        let bodyStartIndex = 0;
        for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (trimmed === '') { bodyStartIndex = i + 1; continue; }
            if (/^\\usetikzlibrary\s*\{/.test(trimmed)) {
                userLibLines.push(trimmed);
                bodyStartIndex = i + 1;
            } else {
                break;
            }
        }
        const body = lines.slice(bodyStartIndex).join('\n').trim();

        // Detect whether body already contains a tikzpicture environment.
        const hasEnvironment = /\\begin\s*\{tikzpicture\}/.test(body);

        const bodyBlock = hasEnvironment
            ? body
            : `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}`;

        const userLibSection = userLibLines.length > 0
            ? userLibLines.join('\n') + '\n'
            : '';

        const tex = [
            `\\documentclass[tikz,border=4pt]{standalone}`,
            `\\usetikzlibrary{${DEFAULT_LIBRARIES}}`,
            userLibSection.trimEnd(),
            `\\begin{document}`,
            bodyBlock,
            `\\end{document}`,
        ].filter(l => l !== '').join('\n') + '\n';

        return { ok: true, tex };
    }

    /**
     * Render one TikZ source string to SVG. Uses cache; renders on miss.
     * Enqueued via serial queue — one subprocess at a time.
     */
    static async render(source: string): Promise<TikzRenderResult> {
        const normalized = source.replace(/\r\n/g, '\n').trimEnd();
        const key = _cacheKey(normalized);

        const cached = _cache.get(key);
        if (cached) { return cached; }

        const result = await enqueue(() => TikzRenderer._renderWithLatex(normalized));
        _cache.set(key, result);
        return result;
    }

    /**
     * Synchronous pass: replace tikz-pending divs that are already in cache.
     * Does not spawn any subprocess. Returns the HTML immediately.
     */
    static resolveCacheHits(html: string): string {
        return html.replace(
            /<div class="tikz-pending" data-tikz="([^"]*)"[^>]*><\/div>/g,
            (_match, b64, offset, str, groups) => {
                const attrs = _match;
                const sourceLine = _extractSourceLine(attrs);
                let source: string;
                try { source = Buffer.from(b64, 'base64url').toString('utf-8'); } catch { return _errorHtml('Failed to decode TikZ source.', sourceLine); }
                const key = _cacheKey(source.replace(/\r\n/g, '\n').trimEnd());
                const cached = _cache.get(key);
                if (!cached) { return _loadingHtml(sourceLine); }
                return _resultToHtml(cached, sourceLine);
            }
        );
    }

    /**
     * Async pass: render all remaining tikz-pending divs (cache misses).
     * Returns fully resolved HTML. Processes blocks serially.
     */
    static async resolveAll(html: string): Promise<string> {
        // Collect all pending blocks first so we can process them.
        const pendingRegex = /<div class="tikz-pending" data-tikz="([^"]*)"([^>]*)><\/div>/g;
        const blocks: Array<{ full: string; b64: string; attrs: string }> = [];
        let m: RegExpExecArray | null;
        while ((m = pendingRegex.exec(html)) !== null) {
            blocks.push({ full: m[0], b64: m[1], attrs: m[2] });
        }

        if (blocks.length === 0) { return html; }

        let resolved = html;
        for (const block of blocks) {
            const sourceLine = _extractSourceLine(block.attrs + ` data-tikz="${block.b64}"`);
            let source: string;
            try {
                source = Buffer.from(block.b64, 'base64url').toString('utf-8');
            } catch {
                resolved = resolved.replace(block.full, _errorHtml('Failed to decode TikZ source.', sourceLine));
                continue;
            }

            const result = await TikzRenderer.render(source);
            resolved = resolved.replace(block.full, _resultToHtml(result, sourceLine));
        }

        return resolved;
    }

    /**
     * Replace all tikz-pending divs with "LaTeX unavailable" placeholders.
     * Synchronous. Used when pdflatex/dvisvgm are not on PATH.
     */
    static resolveUnavailable(html: string): string {
        return html.replace(
            /<div class="tikz-pending"[^>]*><\/div>/g,
            (_match) => {
                const sourceLine = _extractSourceLine(_match);
                return `<div class="tikz-error tikz-unavailable" ${_sourceLineAttr(sourceLine)}>` +
                    `<div class="tikz-error-label">TikZ not available</div>` +
                    `<div class="tikz-error-msg">TikZ rendering requires <code>pdflatex</code> and <code>dvisvgm</code>. ` +
                    `<a href="https://www.tug.org/texlive/">Install TeX Live</a> to enable this feature.</div>` +
                    `</div>`;
            }
        );
    }

    /** Internal: spawn pdflatex + dvisvgm in an isolated temp directory. */
    private static async _renderWithLatex(source: string): Promise<TikzRenderResult> {
        const texResult = TikzRenderer._buildTexFile(source);
        if (!texResult.ok) { return texResult; }

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-tikz-'));
        const texFile = path.join(tmpDir, 'diagram.tex');
        const dviFile = path.join(tmpDir, 'diagram.dvi');
        const svgFile = path.join(tmpDir, 'diagram.svg');

        try {
            fs.writeFileSync(texFile, texResult.tex, 'utf-8');

            // Step 1: pdflatex → DVI
            const latexResult = await _spawnWithTimeout(
                'pdflatex',
                ['-interaction=nonstopmode', '-no-shell-escape', '-output-format=dvi', 'diagram.tex'],
                { cwd: tmpDir, timeout: 30_000 }
            );
            if (!latexResult.ok) {
                const excerpt = _stderrExcerpt(latexResult.stderr, latexResult.stdout);
                return { ok: false, error: excerpt };
            }

            if (!fs.existsSync(dviFile)) {
                return { ok: false, error: 'pdflatex did not produce a DVI file.' };
            }

            // Step 2: dvisvgm → SVG
            const svgResult = await _spawnWithTimeout(
                'dvisvgm',
                ['--no-fonts', 'diagram.dvi', '--output=diagram.svg'],
                { cwd: tmpDir, timeout: 30_000 }
            );
            if (!svgResult.ok) {
                return { ok: false, error: `dvisvgm failed: ${svgResult.stderr.slice(0, 300)}` };
            }

            if (!fs.existsSync(svgFile)) {
                return { ok: false, error: 'dvisvgm did not produce an SVG file.' };
            }

            let svg = fs.readFileSync(svgFile, 'utf-8');
            // Strip XML declaration — makes it safe to inline in HTML.
            svg = svg.replace(/<\?xml[^?]*\?>\s*/i, '').trim();

            return { ok: true, svg };

        } finally {
            // Best-effort cleanup — never throw from finally.
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function _extractSourceLine(attrs: string): string {
    const m = attrs.match(/data-source-line="([^"]*)"/);
    return m ? m[1] : '';
}

function _sourceLineAttr(line: string): string {
    return line ? `data-source-line="${line}"` : '';
}

function _resultToHtml(result: TikzRenderResult, sourceLine: string): string {
    if (result.ok) {
        return `<div class="tikz-diagram" ${_sourceLineAttr(sourceLine)}>${result.svg}</div>`;
    }
    return _errorHtml(result.error, sourceLine);
}

function _errorHtml(message: string, sourceLine: string): string {
    const escaped = message
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    return `<div class="tikz-error" ${_sourceLineAttr(sourceLine)}>` +
        `<div class="tikz-error-label">TikZ render error</div>` +
        `<pre class="tikz-error-msg">${escaped}</pre>` +
        `</div>`;
}

function _loadingHtml(sourceLine: string): string {
    return `<div class="tikz-loading" ${_sourceLineAttr(sourceLine)}>Rendering TikZ…</div>`;
}

function _stderrExcerpt(stderr: string, stdout: string): string {
    // pdflatex writes errors to stdout (not stderr).
    // Extract lines starting with '!' which are LaTeX error lines.
    const combined = (stdout + '\n' + stderr).split('\n');
    const errorLines = combined
        .filter(l => l.startsWith('!') || l.startsWith('l.'))
        .slice(0, 8)
        .join('\n');
    return errorLines || stderr.slice(0, 400) || 'pdflatex exited with an error.';
}

interface SpawnResult {
    ok: boolean;
    stdout: string;
    stderr: string;
}

function _spawnWithTimeout(
    cmd: string,
    args: string[],
    opts: { cwd: string; timeout: number }
): Promise<SpawnResult> {
    return new Promise(resolve => {
        const child = execFile(cmd, args, { cwd: opts.cwd, timeout: opts.timeout }, (err, stdout, stderr) => {
            if (err) {
                resolve({ ok: false, stdout: stdout ?? '', stderr: stderr ?? '' });
            } else {
                resolve({ ok: true, stdout: stdout ?? '', stderr: stderr ?? '' });
            }
        });
        void child; // used only for side effects via the callback
    });
}
