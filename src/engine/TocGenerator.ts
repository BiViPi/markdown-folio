import { TocItem, slugify } from '../shared/types';
import MarkdownIt from 'markdown-it';

export class TocGenerator {
    private static readonly _md = new MarkdownIt();

    /**
     * Extracts headings (h1-h6) from markdown content.
     */
    public static extract(markdown: string): TocItem[] {
        const tokens = TocGenerator._md.parse(markdown, {});
        const items: TocItem[] = [];
        const slugCounts = new Map<string, number>();

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (token.type !== 'heading_open') {
                continue;
            }

            const level = Number(token.tag.replace('h', ''));
            const inline = tokens[i + 1];
            if (!inline || inline.type !== 'inline') {
                continue;
            }

            const text = inline.content.trim();
            if (!text) {
                continue;
            }

            const baseSlug = slugify(text);
            const duplicateIndex = slugCounts.get(baseSlug) ?? 0;
            slugCounts.set(baseSlug, duplicateIndex + 1);

            const slug = duplicateIndex === 0 ? baseSlug : `${baseSlug}-${duplicateIndex}`;
            items.push({ level, text, slug });
        }

        return items;
    }
}
