/**
 * Predicate used by the webview to decide whether the current theme is light
 * (so Mermaid renders in its 'default' theme) or dark (so Mermaid renders in
 * its 'dark' theme).
 *
 * Phase 1 of the v1.5.4 plan extracts this predicate without changing its
 * behavior. The current logic ONLY treats `ivory-mode` (and the historic
 * `sepia-mode` class that does not exist in the CSS) as light. This is the
 * documented v1.5.3 behavior; Phase 2 will correct the light set to include
 * `serene-mode` and `github-mode`.
 */

export interface ClassListLike {
    contains(token: string): boolean;
}

export function isLightTheme(classList: ClassListLike): boolean {
    return classList.contains('ivory-mode') || classList.contains('sepia-mode');
}

export function getMermaidTheme(classList: ClassListLike): 'default' | 'dark' {
    return isLightTheme(classList) ? 'default' : 'dark';
}
