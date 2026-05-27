export function transformTikzSvgColors(svg: string, darkMode: boolean): string {
    if (!darkMode) {
        return svg;
    }

    let transformed = svg;
    const bgColor = 'var(--page-bg)';

    const blackPatterns = ['#000000', '#000', 'black', 'rgb\\(0,\\s*0,\\s*0\\)'];
    const whitePatterns = ['#ffffff', '#fff', 'white', 'rgb\\(255,\\s*255,\\s*255\\)'];
    const colorAttrs = ['fill', 'stroke', 'color', 'stop-color'];

    const replaceColorAttrs = (input: string, patterns: string[], replacement: string): string => {
        let out = input;
        for (const attr of colorAttrs) {
            for (const pattern of patterns) {
                out = out.replace(new RegExp(`${attr}="${pattern}"`, 'gi'), `${attr}="${replacement}"`);
                out = out.replace(new RegExp(`${attr}='${pattern}'`, 'gi'), `${attr}="${replacement}"`);
            }
        }
        return out;
    };

    const replaceInlineStyleColors = (input: string, patterns: string[], replacement: string): string => {
        let out = input;
        for (const attr of colorAttrs) {
            for (const pattern of patterns) {
                out = out.replace(
                    new RegExp(`(${attr}\\s*:\\s*)${pattern}(\\s*;?)`, 'gi'),
                    `$1${replacement}$2`
                );
            }
        }
        return out;
    };

    transformed = replaceColorAttrs(transformed, blackPatterns, 'currentColor');
    transformed = replaceColorAttrs(transformed, whitePatterns, bgColor);

    transformed = replaceInlineStyleColors(transformed, blackPatterns, 'currentColor');
    transformed = replaceInlineStyleColors(transformed, whitePatterns, bgColor);

    // dvisvgm often turns labels into <use> glyph references under <g> groups
    // with no explicit fill attribute. In dark themes SVG's default fill stays
    // black, so force the root SVG to inherit the surrounding text color.
    transformed = transformed.replace(/<svg\b([^>]*)>/i, (fullTag, attrs) => {
        if (/\bfill\s*=\s*(['"]).*?\1/i.test(attrs)) {
            return fullTag;
        }
        if (/\bcolor\s*=\s*(['"]).*?\1/i.test(attrs)) {
            return fullTag;
        }
        if (/\bstyle\s*=\s*(['"])[\s\S]*?\bfill\s*:/i.test(attrs)) {
            return fullTag;
        }
        if (/\bstyle\s*=\s*(['"])[\s\S]*?\bcolor\s*:/i.test(attrs)) {
            return fullTag;
        }
        return fullTag.replace(/>$/, ' fill="currentColor">');
    });

    transformed = transformed.replace(/<text\b([^>]*)>/gi, (fullTag, attrs) => {
        if (/\bfill\s*=\s*(['"]).*?\1/i.test(attrs)) {
            return fullTag;
        }
        if (/\bcolor\s*=\s*(['"]).*?\1/i.test(attrs)) {
            return fullTag;
        }
        if (/\bstyle\s*=\s*(['"])[\s\S]*?\bfill\s*:/i.test(attrs)) {
            return fullTag;
        }
        if (/\bstyle\s*=\s*(['"])[\s\S]*?\bcolor\s*:/i.test(attrs)) {
            return fullTag;
        }
        return fullTag.replace(/>$/, ' fill="currentColor">');
    });

    return transformed;
}
