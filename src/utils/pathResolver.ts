import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class PathResolver {
    /**
     * Resolves local image paths in markdown and raw HTML <img> tags to data: URI (base64).
     * This is necessary for webview and static exports to display images correctly.
     */
    public static resolveImages(markdown: string, documentDir: string): string {
        const withMarkdownImages = markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, rawTarget) => {
            const parsed = this._parseMarkdownImageTarget(rawTarget);
            if (!parsed) {
                return match;
            }

            const dataUri = this._toDataUri(parsed.path, documentDir);
            if (!dataUri) {
                return match;
            }

            const altAttr = this._escapeHtmlAttribute(alt);
            const titleAttr = parsed.title
                ? ` title="${this._escapeHtmlAttribute(this._stripWrappingQuotes(parsed.title))}"`
                : '';
            return `<img src="${dataUri}" alt="${altAttr}"${titleAttr}>`;
        });

        return withMarkdownImages.replace(
            /(<img\b[^>]*\bsrc\s*=\s*)(["'])([^"']+)(\2[^>]*>)/gi,
            (match, prefix, quote, source, suffix) => {
                const dataUri = this._toDataUri(source, documentDir);
                if (!dataUri) {
                    return match;
                }

                return `${prefix}${quote}${dataUri}${suffix}`;
            }
        );
    }

    private static _parseMarkdownImageTarget(rawTarget: string): { path: string; title?: string } | null {
        const target = rawTarget.trim();
        if (!target) {
            return null;
        }

        if (target.startsWith('<')) {
            const endIndex = target.indexOf('>');
            if (endIndex === -1) {
                return null;
            }

            const imagePath = target.slice(1, endIndex).trim();
            const title = target.slice(endIndex + 1).trim();
            return {
                path: imagePath,
                title: title || undefined
            };
        }

        const titleMatch = target.match(/^(\S+)(?:\s+((?:"[^"]*")|(?:'[^']*')))?$/);
        if (!titleMatch) {
            return { path: target };
        }

        return {
            path: titleMatch[1],
            title: titleMatch[2]
        };
    }

    private static _toDataUri(imageUrl: string, documentDir: string): string | null {
        if (!imageUrl) {
            return null;
        }

        const normalizedUrl = imageUrl.trim();
        if (
            normalizedUrl.startsWith('http://') ||
            normalizedUrl.startsWith('https://') ||
            normalizedUrl.startsWith('data:')
        ) {
            return null;
        }

        try {
            const absolutePath = path.isAbsolute(normalizedUrl)
                ? normalizedUrl
                : path.join(documentDir, normalizedUrl);

            if (!fs.existsSync(absolutePath)) {
                return null;
            }

            const extension = path.extname(absolutePath).slice(1).toLowerCase();
            const mimeMap: Record<string, string> = {
                'jpg': 'jpeg',
                'jpeg': 'jpeg',
                'png': 'png',
                'gif': 'gif',
                'svg': 'svg+xml',
                'webp': 'webp'
            };
            const mime = mimeMap[extension] || extension;
            const content = fs.readFileSync(absolutePath);
            const base64 = content.toString('base64');
            return `data:image/${mime};base64,${base64}`;
        } catch (err) {
            console.error(`Failed to resolve image path: ${imageUrl}`, err);
            return null;
        }
    }

    private static _stripWrappingQuotes(value: string): string {
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith('\'') && value.endsWith('\''))
        ) {
            return value.slice(1, -1);
        }

        return value;
    }

    private static _escapeHtmlAttribute(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
}
