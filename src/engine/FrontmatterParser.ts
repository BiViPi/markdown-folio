export class FrontmatterParser {
    /**
     * Extracts title, author, and date from YAML front matter.
     * Returns lineOffset = number of lines consumed by the frontmatter block.
     */
    public static extract(markdownContent: string): {
        title?: string;
        author?: string;
        date?: string;
        content: string;
        lineOffset: number;
    } {
        // Capture frontmatter block (match[1]) and remainder (match[2]) separately
        // so we can count newlines in only the stripped prefix — NOT the whole document.
        const frontmatterRegex = /^(---\r?\n[\s\S]*?\r?\n---\r?\n)([\s\S]*)$/;
        const match = markdownContent.match(frontmatterRegex);

        if (match) {
            const frontmatterBlock = match[1]; // e.g. "---\ntitle: Foo\n---\n"
            const content = match[2];
            const yaml = frontmatterBlock.replace(/^---\r?\n/, '').replace(/\r?\n---\r?\n$/, '');

            const titleMatch = yaml.match(/^title:\s*(.*)$/m);
            const authorMatch = yaml.match(/^author:\s*(.*)$/m);
            const dateMatch = yaml.match(/^date:\s*(.*)$/m);

            // Count newlines in the stripped prefix to get correct line offset
            const lineOffset = (frontmatterBlock.match(/\n/g) || []).length;

            return {
                title: titleMatch ? titleMatch[1].replace(/['"]/g, '').trim() : undefined,
                author: authorMatch ? authorMatch[1].replace(/['"]/g, '').trim() : undefined,
                date: dateMatch ? dateMatch[1].replace(/['"]/g, '').trim() : undefined,
                content,
                lineOffset,
            };
        }

        return { content: markdownContent, lineOffset: 0 };
    }
}
