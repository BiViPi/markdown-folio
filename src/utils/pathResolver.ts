import * as path from 'path';
import * as fs from 'fs';

/**
 * Reason an image path was not embedded by `PathResolver.resolveImages`. The
 * host (PreviewPanel) reads this list to surface a single warning per render.
 */
export interface BlockedImage {
    /** The original `src` / target string written in the markdown. */
    source: string;
    /** Classification of why the resolver refused to embed it. */
    reason: 'absolute-rejected' | 'extension-blocked' | 'not-found';
}

export interface ResolveImagesResult {
    markdown: string;
    diagnostics: BlockedImage[];
}

const ALLOWED_IMAGE_EXTENSIONS: Readonly<Record<string, string>> = {
    jpg: 'jpeg',
    jpeg: 'jpeg',
    png: 'png',
    gif: 'gif',
    svg: 'svg+xml',
    webp: 'webp',
};

export class PathResolver {
    /**
     * Resolves local image paths in markdown and raw HTML <img> tags to data: URI (base64).
     *
     * Phase 3 hardening (02-security-hardening §4):
     *   - Strict image extension allowlist (jpg/jpeg/png/gif/svg/webp).
     *   - Absolute-path Policy A: absolute paths are rejected outright.
     *   - Additive diagnostics: callers pass an array; the resolver pushes
     *     `{ source, reason }` for each blocked path. The string return is
     *     unchanged; existing callers that ignore the array still compile.
     */
    public static resolveImages(markdown: string, documentDir: string): string {
        return this._resolveImages(markdown, documentDir);
    }

    /**
     * Structured diagnostics API required by the v1.5.4 Phase 3 plan.
     * Keeps the original string-returning API untouched for compatibility.
     */
    public static resolveImagesWithDiagnostics(markdown: string, documentDir: string): ResolveImagesResult {
        const diagnostics: BlockedImage[] = [];
        return {
            markdown: this._resolveImages(markdown, documentDir, diagnostics),
            diagnostics,
        };
    }

    private static _resolveImages(
        markdown: string,
        documentDir: string,
        diagnostics?: BlockedImage[]
    ): string {
        const withMarkdownImages = markdown.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, rawTarget) => {
            const parsed = this._parseMarkdownImageTarget(rawTarget);
            if (!parsed) {
                return match;
            }

            const dataUri = this._toDataUri(parsed.path, documentDir, diagnostics);
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
                const dataUri = this._toDataUri(source, documentDir, diagnostics);
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

    private static _toDataUri(
        imageUrl: string,
        documentDir: string,
        diagnostics?: BlockedImage[]
    ): string | null {
        if (!imageUrl) {
            return null;
        }

        const normalizedUrl = imageUrl.trim();
        if (
            normalizedUrl.startsWith('http://') ||
            normalizedUrl.startsWith('https://') ||
            normalizedUrl.startsWith('data:')
        ) {
            // Remote and data URIs are out of scope for this resolver; they pass
            // through to the renderer unchanged and are NOT diagnostics.
            return null;
        }

        // Policy A: reject all absolute paths. Workspace-scoped absolute paths
        // can be revisited in 1.6.0 (master plan §8).
        if (path.isAbsolute(normalizedUrl)) {
            diagnostics?.push({ source: imageUrl, reason: 'absolute-rejected' });
            return null;
        }

        // Extension allowlist applies to the resolved path. Done before the
        // existsSync check so an attacker probing for sensitive files cannot
        // distinguish allowed-but-missing from blocked-extension.
        const extension = path.extname(normalizedUrl).slice(1).toLowerCase();
        const mime = ALLOWED_IMAGE_EXTENSIONS[extension];
        if (!mime) {
            diagnostics?.push({ source: imageUrl, reason: 'extension-blocked' });
            return null;
        }

        const absolutePath = path.join(documentDir, normalizedUrl);

        if (!fs.existsSync(absolutePath)) {
            diagnostics?.push({ source: imageUrl, reason: 'not-found' });
            return null;
        }

        try {
            const content = fs.readFileSync(absolutePath);
            const base64 = content.toString('base64');
            return `data:image/${mime};base64,${base64}`;
        } catch {
            // IO failure on an allowed path. Treat as not-found for the user
            // surface (the file may have been deleted between checks).
            diagnostics?.push({ source: imageUrl, reason: 'not-found' });
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
