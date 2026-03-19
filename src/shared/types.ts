export interface TocItem {
    level: number;
    text: string;
    slug: string;
}

/**
 * Common slugify function to maintain consistency between TocGenerator and markdown-it-anchor.
 */
export function slugify(text: string): string {
    const slug = text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[\u0111\u0110]/g, 'd')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');

    return slug || 'section';
}
