export class FrontmatterParser {
    /**
     * Extracts title, author, and date from YAML front matter.
     */
    public static extract(markdownContent: string): { title?: string, author?: string, date?: string, content: string } {
        const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;
        const match = markdownContent.match(frontmatterRegex);

        if (match) {
            const yaml = match[1];
            const content = match[2];
            const titleMatch = yaml.match(/^title:\s*(.*)$/m);
            const authorMatch = yaml.match(/^author:\s*(.*)$/m);
            const dateMatch = yaml.match(/^date:\s*(.*)$/m);

            return {
                title: titleMatch ? titleMatch[1].replace(/['"]/g, '').trim() : undefined,
                author: authorMatch ? authorMatch[1].replace(/['"]/g, '').trim() : undefined,
                date: dateMatch ? dateMatch[1].replace(/['"]/g, '').trim() : undefined,
                content: content
            };
        }

        return { content: markdownContent };
    }
}
