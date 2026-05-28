import { afterEach, describe, expect, it, vi } from 'vitest';
import { TikzRenderer } from '../src/engine/TikzRenderer';

describe('TikzRenderer diagnostics', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        TikzRenderer.resetAvailabilityCache();
    });

    it('extracts actionable tikzjax TeX lines from captured console output', () => {
        const excerpt = (TikzRenderer as typeof TikzRenderer & {
            _extractTikzJaxErrorExcerpt: (lines: string[], fallbackMessage: string) => string;
        })._extractTikzJaxErrorExcerpt(
            [
                'TikZJax: Rendering input:',
                'some preamble',
                "! Package PGF Math Error: Unknown operator `a' or `an' (in '0.7and 0.7*0.65').",
                'Type H <return> for immediate help.',
                'l.10     }',
                '! Emergency stop.',
            ],
            'TeX engine render failed. Set `options.showConsole` to `true` to see logs.'
        );

        expect(excerpt).toContain('! Package PGF Math Error');
        expect(excerpt).toContain('l.10');
        expect(excerpt).toContain('! Emergency stop.');
        expect(excerpt).not.toContain('TikZJax: Rendering input:');
    });

    it('builds shaded tikzjax render options without forcing SVG optimization flags', () => {
        const options = (TikzRenderer as typeof TikzRenderer & {
            _buildTikzJaxRenderOptions: (userLibLines: string[]) => {
                showConsole?: boolean;
                tikzLibraries?: string;
                disableOptimize?: boolean;
            };
        })._buildTikzJaxRenderOptions([
            '\\usetikzlibrary{patterns,shadows}',
            '\\usetikzlibrary{calc}',
        ]);

        expect(options.showConsole).toBe(true);
        expect(options.disableOptimize).toBeUndefined();
        expect(options.tikzLibraries).toBe('calc,arrows.meta,shapes,positioning,decorations.pathmorphing,patterns,shadows');
    });

    it('adds a standard-backend diagnostic probe after shaded tikzjax failure when system LaTeX is available', async () => {
        vi.spyOn(TikzRenderer as typeof TikzRenderer & {
            _runTikzJaxRender: (bodyBlock: string, userLibLines: string[]) => Promise<unknown>;
        }, '_runTikzJaxRender').mockResolvedValue({
            ok: false,
            message: 'TeX engine render failed. Set `options.showConsole` to `true` to see logs.',
            consoleLines: [
                "! Package PGF Math Error: Unknown operator `a' or `an' (in '0.7and 0.7*0.65').",
                'l.10     }',
            ],
        });
        vi.spyOn(TikzRenderer, 'isAvailable').mockResolvedValue(true);
        vi.spyOn(TikzRenderer as unknown as {
            _renderWithLatex: (source: string) => Promise<unknown>;
        }, '_renderWithLatex').mockResolvedValue({
            ok: false,
            error: '! Package PGF Math Error: Unknown operator `a\' or `an\'\nl.11     }',
        });

        const result = await (TikzRenderer as unknown as {
            _renderWithTikzJax: (source: string) => Promise<{ ok: boolean; error?: string }>;
        })._renderWithTikzJax('\\begin{tikzpicture}\\shade[left color=red,right color=blue] (0,0) rectangle (1,1);\\end{tikzpicture}');

        expect(result.ok).toBe(false);
        expect(result.error).toContain('node-tikzjax diagnostic:');
        expect(result.error).toContain('! Package PGF Math Error');
        expect(result.error).toContain('System LaTeX diagnostic:');
        expect(result.error).toContain('l.11');
    });

    it('returns install guidance when shaded tikzjax failure occurs without system LaTeX', async () => {
        vi.spyOn(TikzRenderer as typeof TikzRenderer & {
            _runTikzJaxRender: (bodyBlock: string, userLibLines: string[]) => Promise<unknown>;
        }, '_runTikzJaxRender').mockResolvedValue({
            ok: false,
            message: 'TeX engine render failed. Set `options.showConsole` to `true` to see logs.',
            consoleLines: [
                '! Undefined control sequence.',
                'l.7 \\brokenmacro',
            ],
        });
        vi.spyOn(TikzRenderer, 'isAvailable').mockResolvedValue(false);
        const latexSpy = vi.spyOn(TikzRenderer as unknown as {
            _renderWithLatex: (source: string) => Promise<unknown>;
        }, '_renderWithLatex');

        const result = await (TikzRenderer as unknown as {
            _renderWithTikzJax: (source: string) => Promise<{ ok: boolean; error?: string }>;
        })._renderWithTikzJax('\\begin{tikzpicture}\\shade[left color=red,right color=blue] (0,0) rectangle (1,1);\\end{tikzpicture}');

        expect(result.ok).toBe(false);
        expect(result.error).toContain('node-tikzjax diagnostic:');
        expect(result.error).toContain('! Undefined control sequence.');
        expect(result.error).toContain('Install TeX Live or MiKTeX');
        expect(latexSpy).not.toHaveBeenCalled();
    });

    it('caches shaded failure outcomes for the current session', async () => {
        const renderSpy = vi.spyOn(TikzRenderer as unknown as {
            _renderWithTikzJax: (source: string) => Promise<unknown>;
        }, '_renderWithTikzJax').mockResolvedValue({
            ok: false,
            error: 'node-tikzjax diagnostic:\n! Failure\nl.10',
        });

        const source = '\\begin{tikzpicture}\\shade[left color=red,right color=blue] (0,0) rectangle (1,1);\\end{tikzpicture}%cache-test';
        const first = await TikzRenderer.render(source);
        const second = await TikzRenderer.render(source);

        expect(first).toEqual(second);
        expect(renderSpy).toHaveBeenCalledTimes(1);
    });

});
