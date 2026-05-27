import { describe, expect, it } from 'vitest';
import { transformTikzSvgColors } from '../src/engine/TikzSvgColorTransform';

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
