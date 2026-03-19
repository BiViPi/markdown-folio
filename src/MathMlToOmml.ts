/**
 * MathMlToOmml — Convert KaTeX-generated MathML to OOXML Math (OMML).
 *
 * Handles the subset of MathML elements that KaTeX generates.
 * Returns the inner OMML content (without <m:oMath> wrapper).
 * Caller is responsible for wrapping in <m:oMath>...</m:oMath>
 * (inline) or <m:oMathPara><m:oMath>...</m:oMath></m:oMathPara> (display).
 *
 * The xmlns:m namespace must be declared on <w:document> by the caller.
 */

interface MmlNode {
    tag: string;
    attrs: Record<string, string>;
    children: (MmlNode | string)[];
}

export class MathMlToOmml {
    /**
     * Convert a <math>...</math> string to OMML inner content.
     * @param mathMl  Full MathML string (may include surrounding <span class="katex">)
     * @returns       OMML XML string without <m:oMath> wrapper
     */
    static convert(mathMl: string): string {
        // KaTeX wraps in <span class="katex"><math...>...</math></span>
        // Extract just the <math> element
        const mathMatch = mathMl.match(/<math[\s\S]*<\/math>/);
        if (!mathMatch) { return ''; }
        const root = MathMlToOmml._parse(mathMatch[0]);
        return MathMlToOmml._conv(root);
    }

    // ---- XML parser ----

    private static _parse(xml: string): MmlNode {
        const root: MmlNode = { tag: '_root', attrs: {}, children: [] };
        const stack: MmlNode[] = [root];

        const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9:.-]*)([^>]*?)(\/?)>/g;
        let lastIdx = 0;
        let match: RegExpExecArray | null;

        while ((match = tagRe.exec(xml)) !== null) {
            const [fullMatch, closing, rawTag, attrStr, selfClose] = match;
            // Strip namespace prefix for switch matching (math:mi → mi, etc.)
            const tag = rawTag.includes(':') ? rawTag.split(':')[1] : rawTag;

            // Text between tags
            if (match.index > lastIdx) {
                const text = MathMlToOmml._decodeXml(xml.slice(lastIdx, match.index));
                if (text) { stack[stack.length - 1].children.push(text); }
            }
            lastIdx = match.index + fullMatch.length;

            if (closing) {
                if (stack.length > 1) { stack.pop(); }
            } else {
                const attrs = MathMlToOmml._parseAttrs(attrStr);
                const node: MmlNode = { tag, attrs, children: [] };
                stack[stack.length - 1].children.push(node);
                if (!selfClose) { stack.push(node); }
            }
        }

        // Trailing text
        if (lastIdx < xml.length) {
            const text = MathMlToOmml._decodeXml(xml.slice(lastIdx));
            if (text) { stack[stack.length - 1].children.push(text); }
        }

        return root.children[0] as MmlNode ?? root;
    }

    private static _parseAttrs(attrStr: string): Record<string, string> {
        const attrs: Record<string, string> = {};
        const re = /([a-zA-Z][a-zA-Z0-9:.-]*)="([^"]*)"/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(attrStr)) !== null) {
            attrs[m[1]] = MathMlToOmml._decodeXml(m[2]);
        }
        return attrs;
    }

    private static _decodeXml(s: string): string {
        return s
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
            .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
            .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
    }

    private static _encodeXml(s: string): string {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    private static _textContent(node: MmlNode | string): string {
        if (typeof node === 'string') { return node; }
        return node.children.map(c => MathMlToOmml._textContent(c)).join('');
    }

    // ---- MathML → OMML converter ----

    private static _conv(node: MmlNode | string): string {
        if (typeof node === 'string') { return MathMlToOmml._encodeXml(node); }

        const ch = node.children;
        const all = () => ch.map(c => MathMlToOmml._conv(c)).join('');
        const el = (i: number) => MathMlToOmml._conv(ch[i]);

        switch (node.tag) {
            // Passthrough containers
            case 'math':
            case 'mrow':
            case 'mpadded':
            case 'mstyle':
            case 'merror':
                return all();

            case 'semantics':
                // First child is the display form; annotation is last → skip it
                if (ch.length === 0) { return ''; }
                return MathMlToOmml._conv(ch[0]);

            case 'mi': {
                const t = MathMlToOmml._textContent(node);
                // Single Latin letter → italic; anything else → plain
                const sty = (t.length === 1 && /[a-zA-Z]/.test(t)) ? 'i' : 'p';
                return `<m:r><m:rPr><m:sty m:val="${sty}"/></m:rPr><m:t>${MathMlToOmml._encodeXml(t)}</m:t></m:r>`;
            }

            case 'mn': {
                const t = MathMlToOmml._textContent(node);
                return `<m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>${MathMlToOmml._encodeXml(t)}</m:t></m:r>`;
            }

            case 'mo': {
                const t = MathMlToOmml._textContent(node);
                return `<m:r><m:t>${MathMlToOmml._encodeXml(t)}</m:t></m:r>`;
            }

            case 'mtext': {
                const t = MathMlToOmml._textContent(node);
                return `<m:r><m:rPr><m:nor/></m:rPr><m:t xml:space="preserve">${MathMlToOmml._encodeXml(t)}</m:t></m:r>`;
            }

            case 'mspace':
                return `<m:r><m:t xml:space="preserve"> </m:t></m:r>`;

            case 'mfrac': {
                if (ch.length < 2) { return all(); }
                return `<m:f><m:num>${el(0)}</m:num><m:den>${el(1)}</m:den></m:f>`;
            }

            case 'msqrt':
                return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${all()}</m:e></m:rad>`;

            case 'mroot': {
                if (ch.length < 2) { return all(); }
                return `<m:rad><m:deg>${el(1)}</m:deg><m:e>${el(0)}</m:e></m:rad>`;
            }

            case 'msup': {
                if (ch.length < 2) { return all(); }
                return `<m:sSup><m:e>${el(0)}</m:e><m:sup>${el(1)}</m:sup></m:sSup>`;
            }

            case 'msub': {
                if (ch.length < 2) { return all(); }
                return `<m:sSub><m:e>${el(0)}</m:e><m:sub>${el(1)}</m:sub></m:sSub>`;
            }

            case 'msubsup': {
                if (ch.length < 3) { return all(); }
                return `<m:sSubSup><m:e>${el(0)}</m:e><m:sub>${el(1)}</m:sub><m:sup>${el(2)}</m:sup></m:sSubSup>`;
            }

            case 'mover': {
                if (ch.length < 2) { return all(); }
                const base = el(0);
                const accent = MathMlToOmml._textContent(ch[1] as MmlNode).trim();
                // Overline characters
                if (accent === '\u203E' || accent === '\u0305' || accent === '\u2015') {
                    return `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e>${base}</m:e></m:bar>`;
                }
                // Vector arrow
                if (accent === '\u20D7' || accent === '\u2192') {
                    return `<m:acc><m:accPr><m:chr m:val="&#x20D7;"/></m:accPr><m:e>${base}</m:e></m:acc>`;
                }
                // Default: accent character
                return `<m:acc><m:accPr><m:chr m:val="${MathMlToOmml._encodeXml(accent)}"/></m:accPr><m:e>${base}</m:e></m:acc>`;
            }

            case 'munder': {
                if (ch.length < 2) { return all(); }
                const base = el(0);
                const under = MathMlToOmml._textContent(ch[1] as MmlNode).trim();
                if (under === '\u0332' || under === '\u005F') {
                    return `<m:bar><m:barPr><m:pos m:val="bot"/></m:barPr><m:e>${base}</m:e></m:bar>`;
                }
                return `<m:limLow><m:e>${base}</m:e><m:lim>${el(1)}</m:lim></m:limLow>`;
            }

            case 'munderover': {
                if (ch.length < 3) { return all(); }
                const op = MathMlToOmml._textContent(ch[0] as MmlNode).trim();
                // N-ary operators: integral, sum, product, union, intersection, etc.
                const narySet = new Set(['∫', '∑', '∏', '⋃', '⋂', '∬', '∭', '∮', '⋀', '⋁', '⨆', '⨅']);
                if (narySet.has(op)) {
                    const nChr = MathMlToOmml._encodeXml(op);
                    return `<m:nary><m:naryPr><m:chr m:val="${nChr}"/><m:limLoc m:val="undOvr"/></m:naryPr><m:sub>${el(1)}</m:sub><m:sup>${el(2)}</m:sup><m:e></m:e></m:nary>`;
                }
                // Fallback: limits over operator
                return `<m:limLow><m:e><m:limUpp><m:e>${el(0)}</m:e><m:lim>${el(2)}</m:lim></m:limUpp></m:e><m:lim>${el(1)}</m:lim></m:limLow>`;
            }

            case 'mtable': {
                const rows = ch.filter(c => typeof c !== 'string' && (c as MmlNode).tag === 'mtr');
                return `<m:m>${rows.map(r => MathMlToOmml._conv(r)).join('')}</m:m>`;
            }

            case 'mtr': {
                const cells = ch.filter(c => typeof c !== 'string' && (c as MmlNode).tag === 'mtd');
                return `<m:mr>${cells.map(c => MathMlToOmml._conv(c)).join('')}</m:mr>`;
            }

            case 'mtd':
                return `<m:e>${all()}</m:e>`;

            case 'mphantom':
                return `<m:phant><m:phantPr><m:show m:val="0"/><m:zeroWid m:val="0"/><m:zeroAsc m:val="0"/><m:zeroDesc m:val="0"/></m:phantPr><m:e>${all()}</m:e></m:phant>`;

            case 'menclose': {
                const notation = (node.attrs['notation'] || '').trim();
                if (notation === 'radical') {
                    return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${all()}</m:e></m:rad>`;
                }
                if (notation === 'box' || notation === 'roundedbox') {
                    return `<m:borderBox><m:e>${all()}</m:e></m:borderBox>`;
                }
                return all();
            }

            // Skip annotation content (LaTeX source, MathML-Content)
            case 'annotation':
            case 'annotation-xml':
                return '';

            default:
                // Unknown element: pass through children
                return all();
        }
    }
}
