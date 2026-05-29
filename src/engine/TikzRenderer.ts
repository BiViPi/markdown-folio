import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { execFile } from 'child_process';
import { transformTikzSvgColors } from './TikzSvgColorTransform';

export type TikzRenderResult =
    | { ok: true; svg: string; backend: TikzBackend }
    | { ok: false; error: string };

type TikzBackend = 'standard' | 'shaded';
const SYSTEM_LATEX_INSTALL_HINT = 'System LaTeX not available. Install TeX Live or MiKTeX, then reload the window if you just installed it.';

// Bump when routing policy, output transforms, or bundled runtime versions change in a way
// that can alter rendered output or error formatting. Do not bump for pure refactors.
const RENDERER_VERSION = '1.5.7';

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
const SHADED_BACKEND_PATTERNS = [
    /\\shade\b/,
    /\\shadedraw\b/,
    /\bleft color\s*=/,
    /\bright color\s*=/,
    /\btop color\s*=/,
    /\bbottom color\s*=/,
    /\binner color\s*=/,
    /\bouter color\s*=/,
    /\bmiddle color\s*=/,
    /\bball color\s*=/,
    /\bshading\s*=/,
    /\\pgfdeclarehorizontalshading\b/,
    /\\pgfdeclareverticalshading\b/,
    /\\pgfdeclareradialshading\b/,
];

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
    return crypto.createHash('sha256').update(`${RENDERER_VERSION}:${source}`).digest('hex');
}

// ── Availability ──────────────────────────────────────────────────────────
let _available: boolean | null = null;
let _availableCheckedAt: number = 0;
const AVAILABILITY_NEGATIVE_TTL_MS = 5 * 60 * 1000;
let _tikzJaxImportPromise: Promise<TikzJaxModule> | null = null;

interface TikzJaxModule {
    tex2svg: (input: string, options?: TikzJaxRenderOptions) => Promise<string>;
}

interface TikzJaxRenderOptions {
    showConsole?: boolean;
    tikzLibraries?: string;
    texPackages?: Record<string, string>;
    embedFontCss?: boolean;
    fontCssUrl?: string;
    disableOptimize?: boolean;
    disableSanitize?: boolean;
}

function _checkBinary(cmd: string): Promise<boolean> {
    return new Promise(resolve => {
        const checker = process.platform === 'win32' ? 'where' : 'which';
        execFile(checker, [cmd], { timeout: 5000 }, (err) => resolve(!err));
    });
}

export class TikzRenderer {
    /** Check if pdflatex + dvisvgm are on PATH. Cached after first call. */
    static async isAvailable(): Promise<boolean> {
        if (_available === true) { return true; }
        if (_available === false && Date.now() - _availableCheckedAt < AVAILABILITY_NEGATIVE_TTL_MS) {
            return false;
        }
        const [hasPdflatex, hasDvisvgm] = await Promise.all([
            _checkBinary('pdflatex'),
            _checkBinary('dvisvgm'),
        ]);
        _available = hasPdflatex && hasDvisvgm;
        _availableCheckedAt = Date.now();
        return _available;
    }

    /** Reset availability cache (for testing). */
    static resetAvailabilityCache(): void {
        _available = null;
        _availableCheckedAt = 0;
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
        const backend = _selectBackend(normalized);
        const key = _cacheKey(normalized);

        const cached = _cache.get(key);
        if (cached) { return cached; }

        const result = await enqueue(() => backend === 'shaded'
            ? TikzRenderer._renderWithTikzJax(normalized)
            : TikzRenderer._renderWithLatex(normalized));
        _cache.set(key, result);
        return result;
    }

    /**
     * Synchronous pass: replace tikz-pending divs that are already in cache.
     * Does not spawn any subprocess. Returns the HTML immediately.
     */
    static resolveCacheHits(html: string, darkMode = false): string {
        return html.replace(
            /<div class="tikz-pending" data-tikz="([^"]*)"[^>]*><\/div>/g,
            (_match, b64, offset, str, groups) => {
                const attrs = _match;
                const sourceLine = _extractSourceLine(attrs);
                let source: string;
                try { source = Buffer.from(b64, 'base64url').toString('utf-8'); } catch { return _errorHtml('Failed to decode TikZ source.', sourceLine); }
                const normalized = source.replace(/\r\n/g, '\n').trimEnd();
                const key = _cacheKey(normalized);
                const cached = _cache.get(key);
                if (!cached) { return _loadingHtml(sourceLine); }
                return _resultToHtml(cached, sourceLine, darkMode);
            }
        );
    }

    /**
     * Async pass: render all remaining tikz-pending divs (cache misses).
     * Returns fully resolved HTML. Processes blocks serially.
     */
    static async resolveAll(html: string, darkMode = false): Promise<string> {
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
            resolved = resolved.replace(block.full, _resultToHtml(result, sourceLine, darkMode));
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
        const parsed = TikzRenderer._parseSource(source);
        if (!parsed.ok) { return parsed; }
        const tex = TikzRenderer._buildStandardTex(parsed.body, parsed.userLibLines);

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-tikz-'));
        const texFile = path.join(tmpDir, 'diagram.tex');
        const dviFile = path.join(tmpDir, 'diagram.dvi');
        const svgFile = path.join(tmpDir, 'diagram.svg');

        try {
            fs.writeFileSync(texFile, tex, 'utf-8');

            // Step 1: pdflatex → DVI
            const latexResult = await _spawnWithTimeout(
                'pdflatex',
                ['-interaction=nonstopmode', '-no-shell-escape', '-output-format=dvi', 'diagram.tex'],
                { cwd: tmpDir, timeout: 30_000 }
            );
            if (!latexResult.ok) {
                const excerpt = _stderrExcerpt(latexResult.stderr, latexResult.stdout, latexResult.errorMessage);
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

            return { ok: true, svg, backend: 'standard' };

        } finally {
            // Best-effort cleanup — never throw from finally.
            try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
    }

    private static async _renderWithTikzJax(source: string): Promise<TikzRenderResult> {
        const parsed = TikzRenderer._parseSource(source);
        if (!parsed.ok) { return parsed; }

        const tikzJaxResult = await TikzRenderer._runTikzJaxRender(parsed.bodyBlock, parsed.userLibLines);
        if (tikzJaxResult.ok) {
            return {
                ok: true,
                svg: tikzJaxResult.svg,
                backend: 'shaded'
            };
        }

        const hasSystemLatex = await TikzRenderer.isAvailable();
        const tikzJaxDiagnostic = TikzRenderer._extractTikzJaxErrorExcerpt(
            tikzJaxResult.consoleLines,
            tikzJaxResult.message
        );

        if (!hasSystemLatex) {
            return {
                ok: false,
                error: _joinDiagnosticSections([
                    _labeledDiagnosticSection('node-tikzjax diagnostic', tikzJaxDiagnostic),
                    SYSTEM_LATEX_INSTALL_HINT,
                ]),
            };
        }

        const standardProbe = await TikzRenderer._renderWithLatex(source);
        return {
            ok: false,
            error: _joinDiagnosticSections([
                _labeledDiagnosticSection('node-tikzjax diagnostic', tikzJaxDiagnostic),
                !standardProbe.ok ? _labeledDiagnosticSection('System LaTeX diagnostic', standardProbe.error) : '',
            ]),
        };
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

function _resultToHtml(result: TikzRenderResult, sourceLine: string, darkMode: boolean): string {
    if (result.ok) {
        const svg = transformTikzSvgColors(result.svg, darkMode);
        return `<div class="tikz-diagram" data-tikz-backend="${result.backend}" ${_sourceLineAttr(sourceLine)}>${svg}</div>`;
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

function _joinDiagnosticSections(sections: Array<string | undefined>): string {
    return sections
        .map(section => section?.trim())
        .filter((section): section is string => Boolean(section))
        .join('\n\n');
}

function _labeledDiagnosticSection(label: string, body: string): string {
    const trimmed = body.trim();
    return trimmed ? `${label}:\n${trimmed}` : '';
}

function _stderrExcerpt(stderr: string, stdout: string, errorMessage?: string): string {
    // pdflatex writes errors to stdout (not stderr).
    // Extract lines starting with '!' which are LaTeX error lines.
    const combined = (stdout + '\n' + stderr).split('\n');
    const errorLines = combined
        .filter(l => l.startsWith('!') || l.startsWith('l.'))
        .slice(0, 8)
        .join('\n');
    return errorLines || stderr.slice(0, 400) || errorMessage || 'pdflatex exited with an error.';
}

interface SpawnResult {
    ok: boolean;
    stdout: string;
    stderr: string;
    errorMessage?: string;
}

function _spawnWithTimeout(
    cmd: string,
    args: string[],
    opts: { cwd: string; timeout: number }
): Promise<SpawnResult> {
    return new Promise(resolve => {
        const child = execFile(cmd, args, { cwd: opts.cwd, timeout: opts.timeout }, (err, stdout, stderr) => {
            if (err) {
                resolve({ ok: false, stdout: stdout ?? '', stderr: stderr ?? '', errorMessage: err.message });
            } else {
                resolve({ ok: true, stdout: stdout ?? '', stderr: stderr ?? '' });
            }
        });
        void child; // used only for side effects via the callback
    });
}

function _selectBackend(source: string): TikzBackend {
    return SHADED_BACKEND_PATTERNS.some(pattern => pattern.test(source)) ? 'shaded' : 'standard';
}

function _mergeTikzLibraries(userLibLines: string[]): string {
    const libs = new Set<string>();
    for (const part of DEFAULT_LIBRARIES.split(',')) {
        const trimmed = part.trim();
        if (trimmed) { libs.add(trimmed); }
    }
    for (const line of userLibLines) {
        const match = line.match(/^\\usetikzlibrary\s*\{([^}]+)\}/);
        if (!match) { continue; }
        for (const name of match[1].split(',')) {
            const trimmed = name.trim();
            if (trimmed) { libs.add(trimmed); }
        }
    }
    return Array.from(libs).join(',');
}

async function _loadTikzJaxModule(): Promise<TikzJaxModule> {
    if (_tikzJaxImportPromise) {
        return _tikzJaxImportPromise;
    }

    _tikzJaxImportPromise = (async () => {
        const modulePath = path.join(__dirname, 'vendor', 'node-tikzjax', 'dist', 'index.js');
        if (!fs.existsSync(modulePath)) {
            throw new Error('Bundled node-tikzjax runtime was not found in dist/vendor/node-tikzjax.');
        }

        const imported = await import(pathToFileURL(modulePath).href) as {
            default?: unknown;
        };

        const candidate = imported.default as
            | ((input: string, options?: TikzJaxRenderOptions) => Promise<string>)
            | { default?: (input: string, options?: TikzJaxRenderOptions) => Promise<string> };

        const tex2svg = typeof candidate === 'function'
            ? candidate
            : typeof candidate?.default === 'function'
                ? candidate.default
                : undefined;

        if (!tex2svg) {
            throw new Error('Bundled node-tikzjax module does not export a usable tex2svg function.');
        }

        return { tex2svg };
    })();

    return _tikzJaxImportPromise;
}

interface ParsedTikzSource {
    ok: true;
    body: string;
    bodyBlock: string;
    userLibLines: string[];
}

function _buildParsedSourceResultError(error: string): { ok: false; error: string } {
    return { ok: false, error };
}

namespace TikzRenderer {
    export function _buildTikzJaxRenderOptions(userLibLines: string[]): TikzJaxRenderOptions {
        return {
            showConsole: true,
            tikzLibraries: _mergeTikzLibraries(userLibLines),
        };
    }

    export async function _runTikzJaxRender(
        bodyBlock: string,
        userLibLines: string[]
    ): Promise<
        | { ok: true; svg: string }
        | { ok: false; message: string; consoleLines: string[] }
    > {
        const capturedLines: string[] = [];
        const originalConsoleLog = console.log;
        console.log = (...args: unknown[]) => {
            capturedLines.push(args.map(arg => String(arg)).join(' '));
        };

        try {
            const tikzJax = await _loadTikzJaxModule();
            const svg = await tikzJax.tex2svg(
                `\\begin{document}\n${bodyBlock}\n\\end{document}`,
                TikzRenderer._buildTikzJaxRenderOptions(userLibLines)
            );
            return { ok: true, svg: svg.trim() };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { ok: false, message, consoleLines: capturedLines };
        } finally {
            console.log = originalConsoleLog;
        }
    }

    export function _extractTikzJaxErrorExcerpt(consoleLines: string[], fallbackMessage: string): string {
        const interestingLines = consoleLines
            .map(line => line.replace(/\r/g, '').trim())
            .filter(line =>
                line.startsWith('!') ||
                line.startsWith('l.') ||
                line.includes('Emergency stop.') ||
                line.includes('LaTeX Error:') ||
                line.includes('Package ')
            )
            .slice(0, 12);

        return interestingLines.join('\n') || fallbackMessage;
    }

    export function _parseSource(source: string): ParsedTikzSource | { ok: false; error: string } {
        for (const pattern of REJECTED_COMMANDS) {
            if (pattern.test(source)) {
                const matched = source.match(pattern)?.[0] ?? '';
                if (/\\usepackage/.test(matched)) {
                    return _buildParsedSourceResultError('\\usepackage{} is not supported in fenced tikz blocks.\nUse \\usetikzlibrary{} to load TikZ libraries.');
                }
                if (/\\begin\s*\{document\}/.test(matched)) {
                    return _buildParsedSourceResultError('Full LaTeX document syntax (\\begin{document}) is not supported.\nWrite only TikZ body content or a \\begin{tikzpicture}...\\end{tikzpicture} block.');
                }
                return _buildParsedSourceResultError(`${matched.trim()} is not supported in fenced tikz blocks.\nExternal file references are disabled for security.`);
            }
        }

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
        const hasEnvironment = /\\begin\s*\{tikzpicture\}/.test(body);
        const bodyBlock = hasEnvironment
            ? body
            : `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}`;

        return { ok: true, body, bodyBlock, userLibLines };
    }

    export function _buildStandardTex(body: string, userLibLines: string[]): string {
        const hasEnvironment = /\\begin\s*\{tikzpicture\}/.test(body);
        const bodyBlock = hasEnvironment
            ? body
            : `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}`;
        const userLibSection = userLibLines.length > 0
            ? userLibLines.join('\n') + '\n'
            : '';

        return [
            `\\documentclass[tikz,border=4pt]{standalone}`,
            `\\usetikzlibrary{${DEFAULT_LIBRARIES}}`,
            userLibSection.trimEnd(),
            `\\begin{document}`,
            bodyBlock,
            `\\end{document}`,
        ].filter(l => l !== '').join('\n') + '\n';
    }
}
