export interface DocumentStats {
    words: number;
    chars: number;
    readingTimeMin: number;
}

export class DocumentStats {
    /**
     * Compute word count, character count, and estimated reading time from
     * raw markdown text (post-frontmatter, pre-render).
     */
    static compute(markdown: string): DocumentStats {
        // Strip YAML frontmatter if present.
        const body = markdown.replace(/^---[\s\S]*?---\n?/, '');

        // Remove markdown syntax that inflates word count.
        const text = body
            .replace(/```[\s\S]*?```/g, ' ')       // fenced code blocks
            .replace(/`[^`]+`/g, ' ')               // inline code
            .replace(/\$\$[\s\S]*?\$\$/g, ' ')      // display math
            .replace(/\$[^$\n]+\$/g, ' ')            // inline math
            .replace(/!\[.*?\]\(.*?\)/g, '')         // images (skip alt text)
            .replace(/\[([^\]]*?)\]\(.*?\)/g, '$1')  // links (keep label)
            .replace(/#{1,6}\s+/g, '')               // heading markers
            .replace(/[*_~>`|]/g, ' ')               // formatting characters
            .trim();

        const words = text.split(/\s+/).filter(w => w.length > 0).length;
        const chars = text.replace(/\s+/g, '').length;
        const readingTimeMin = Math.max(1, Math.ceil(words / 200));

        return { words, chars, readingTimeMin };
    }
}
