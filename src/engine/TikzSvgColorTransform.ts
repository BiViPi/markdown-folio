import { parseDOM } from 'htmlparser2';
import render from 'dom-serializer';

type DomNode = {
    type?: string;
    name?: string;
    data?: string;
    attribs?: Record<string, string>;
    children?: DomNode[];
    parent?: DomNode | null;
};

type Matrix = [number, number, number, number, number, number];

const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];
const INHERITED_TEXT_ATTRS = [
    'fill',
    'stroke',
    'stroke-width',
    'font-family',
    'font-size',
    'font-style',
    'font-weight',
    'opacity',
    'letter-spacing',
    'word-spacing',
    'text-anchor',
    'alignment-baseline',
    'dominant-baseline',
] as const;

export function normalizeTikzJaxTextOrientation(svg: string): string {
    if (!svg.includes('<text') || !svg.includes('transform=')) {
        return svg;
    }

    const dom = parseDOM(svg, { xmlMode: true }) as DomNode[];
    const svgNode = dom.find(node => node.name === 'svg');
    if (!svgNode?.children) {
        return svg;
    }

    const rootFlipGroup = svgNode.children.find(node =>
        node.name === 'g' &&
        typeof node.attribs?.transform === 'string' &&
        _hasNegativeScaleY(node.attribs.transform)
    );
    if (!rootFlipGroup) {
        return svg;
    }

    const liftedTexts: DomNode[] = [];
    _liftTextNodes(rootFlipGroup, [rootFlipGroup], IDENTITY_MATRIX, liftedTexts);
    if (liftedTexts.length === 0) {
        return svg;
    }

    svgNode.children.push(...liftedTexts);
    for (const textNode of liftedTexts) {
        textNode.parent = svgNode;
    }

    return render(dom as never, { xmlMode: true });
}

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

function _liftTextNodes(
    node: DomNode,
    ancestors: DomNode[],
    parentMatrix: Matrix,
    liftedTexts: DomNode[]
): void {
    const nodeMatrix = _multiplyMatrices(parentMatrix, _parseTransform(node.attribs?.transform));
    const children = [...(node.children ?? [])];

    for (const child of children) {
        if (child.name === 'text' && child.attribs) {
            const absoluteMatrix = _multiplyMatrices(nodeMatrix, _parseTransform(child.attribs.transform));
            child.attribs.transform = _formatMatrix(absoluteMatrix);
            _applyInheritedTextAttrs(child, ancestors);
            _detachNode(child, node);
            liftedTexts.push(child);
            continue;
        }

        if (child.children && child.children.length > 0) {
            _liftTextNodes(child, [...ancestors, child], nodeMatrix, liftedTexts);
        }
    }
}

function _applyInheritedTextAttrs(textNode: DomNode, ancestors: DomNode[]): void {
    const attribs = textNode.attribs ?? (textNode.attribs = {});
    for (const attr of INHERITED_TEXT_ATTRS) {
        if (attribs[attr]) {
            continue;
        }
        for (let i = ancestors.length - 1; i >= 0; i--) {
            const inherited = ancestors[i].attribs?.[attr];
            if (inherited) {
                attribs[attr] = inherited;
                break;
            }
        }
    }
}

function _detachNode(node: DomNode, parent: DomNode): void {
    if (!parent.children) {
        return;
    }
    parent.children = parent.children.filter(child => child !== node);
    node.parent = null;
}

function _parseTransform(transformValue: string | undefined): Matrix {
    if (!transformValue) {
        return IDENTITY_MATRIX;
    }

    const operations = [...transformValue.matchAll(/([a-zA-Z]+)\(([^)]*)\)/g)];
    if (operations.length === 0) {
        return IDENTITY_MATRIX;
    }

    let matrix = IDENTITY_MATRIX;
    for (const [, opName, rawArgs] of operations) {
        const args = rawArgs
            .split(/[\s,]+/)
            .map(part => part.trim())
            .filter(Boolean)
            .map(Number)
            .filter(value => Number.isFinite(value));

        let opMatrix = IDENTITY_MATRIX;
        switch (opName) {
        case 'matrix':
            if (args.length === 6) {
                opMatrix = [args[0], args[1], args[2], args[3], args[4], args[5]];
            }
            break;
        case 'translate': {
            const [tx = 0, ty = 0] = args;
            opMatrix = [1, 0, 0, 1, tx, ty];
            break;
        }
        case 'scale': {
            const [sx = 1, sy = sx] = args;
            opMatrix = [sx, 0, 0, sy, 0, 0];
            break;
        }
        case 'rotate': {
            const [degrees = 0, cx = 0, cy = 0] = args;
            const radians = degrees * Math.PI / 180;
            const cos = Math.cos(radians);
            const sin = Math.sin(radians);
            const rotation: Matrix = [cos, sin, -sin, cos, 0, 0];
            opMatrix = (cx === 0 && cy === 0)
                ? rotation
                : _multiplyMatrices(
                    _multiplyMatrices([1, 0, 0, 1, cx, cy], rotation),
                    [1, 0, 0, 1, -cx, -cy]
                );
            break;
        }
        default:
            break;
        }

        matrix = _multiplyMatrices(matrix, opMatrix);
    }

    return matrix;
}

function _multiplyMatrices(left: Matrix, right: Matrix): Matrix {
    const [a1, b1, c1, d1, e1, f1] = left;
    const [a2, b2, c2, d2, e2, f2] = right;
    return [
        a1 * a2 + c1 * b2,
        b1 * a2 + d1 * b2,
        a1 * c2 + c1 * d2,
        b1 * c2 + d1 * d2,
        a1 * e2 + c1 * f2 + e1,
        b1 * e2 + d1 * f2 + f1,
    ];
}

function _formatMatrix(matrix: Matrix): string {
    const normalized = matrix.map(value => {
        const rounded = Math.abs(value) < 1e-10 ? 0 : Number(value.toFixed(6));
        return Number.isInteger(rounded) ? String(rounded) : String(rounded);
    });
    return `matrix(${normalized.join(' ')})`;
}

function _hasNegativeScaleY(transformValue: string): boolean {
    const [, , , d] = _parseTransform(transformValue);
    return d < 0;
}
