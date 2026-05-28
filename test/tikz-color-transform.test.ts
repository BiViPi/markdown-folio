import { describe, expect, it } from 'vitest';
import { normalizeTikzJaxTextOrientation, transformTikzSvgColors } from '../src/engine/TikzSvgColorTransform';

describe('normalizeTikzJaxTextOrientation', () => {
    it('lifts shaded tikzjax text out of the flipped root group with composed transforms', () => {
        const input = '<svg viewBox="-72 -72 281.68 128.036"><g stroke="#000" transform="matrix(1 0 0 -1 68.57 -8.252)"><path d="M0 0"/><g fill="#fff" stroke="#fff"><g fill="#fff" stroke="none" font-family="cmbx10" font-size="10"><text x="68.57" y="-8.252" transform="matrix(.9 0 0 -.9 -183.076 45.784)">Sem</text></g></g></g></svg>';
        const out = normalizeTikzJaxTextOrientation(input);

        expect(out).toContain('<g stroke="#000" transform="matrix(1 0 0 -1 68.57 -8.252)"><path d="M0 0"/><g fill="#fff" stroke="#fff"><g fill="#fff" stroke="none" font-family="cmbx10" font-size="10"/></g></g>');
        expect(out).toContain('<text x="68.57" y="-8.252" transform="matrix(0.9 0 0 0.9 -114.506 -54.036)" fill="#fff" stroke="none" font-family="cmbx10" font-size="10">Sem</text>');
    });

    it('leaves non-flipped SVG text untouched', () => {
        const input = '<svg><g transform="matrix(1 0 0 1 0 0)"><text x="0" y="0">Label</text></g></svg>';
        expect(normalizeTikzJaxTextOrientation(input)).toBe(input);
    });
});

describe('transformTikzSvgColors', () => {
    it('leaves SVG untouched in light mode', () => {
        const input = '<svg><g stroke="#000"><path fill="none" d="M0 0"/></g></svg>';
        expect(transformTikzSvgColors(input, false)).toBe(input);
    });

    it('maps black stroke attributes to currentColor in dark mode', () => {
        const input = '<svg><g stroke="#000"><path fill="none" stroke-width=".8" d="M0 0"/></g></svg>';
        const out = transformTikzSvgColors(input, true);
        expect(out).toContain('stroke="currentColor"');
        expect(out).not.toContain('stroke="#000"');
    });

    it('adds currentColor fill to text nodes that inherit black by default', () => {
        const input = '<svg><text x="0" y="0" stroke="none">Label</text></svg>';
        const out = transformTikzSvgColors(input, true);
        expect(out).toContain('<text x="0" y="0" stroke="none" fill="currentColor">');
    });

    it('adds currentColor fill to the root svg for dvisvgm glyph-based text', () => {
        const input = '<svg version="1.1"><g transform="matrix(1 0 0 1 0 0)"><use xlink:href="#g0-77"/></g></svg>';
        const out = transformTikzSvgColors(input, true);
        expect(out).toContain('<svg version="1.1" fill="currentColor">');
        expect(out).toContain('<use xlink:href="#g0-77"/>');
    });

    it('maps explicit white fills to the page background token in dark mode', () => {
        const input = '<svg><rect fill="#fff" stroke="#000" width="10" height="10"/></svg>';
        const out = transformTikzSvgColors(input, true);
        expect(out).toContain('fill="var(--page-bg)"');
        expect(out).toContain('stroke="currentColor"');
    });
});
