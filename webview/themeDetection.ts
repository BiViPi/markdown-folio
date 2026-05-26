/**
 * Predicate used by the webview to decide whether the current theme is light
 * (so Mermaid renders in its 'default' theme) or dark (so Mermaid renders in
 * its 'dark' theme).
 *
 * Phase 2 of the v1.5.4 plan corrects the light set to match the CSS theme
 * classes that are actually shipped: `ivory-mode`, `serene-mode`, `github-mode`.
 * The earlier predicate checked a non-existent `sepia-mode` class and excluded
 * `serene-mode` and `github-mode` from the light branch (audit 03 #5 / 04
 * NEW-5 extension). The dead `sepia-mode` check is removed.
 *
 * If the CSS theme set changes (a new theme added or an existing one removed),
 * update `LIGHT_THEME_CLASSES` here. This module is the single source of truth
 * for the Mermaid theme decision.
 */

export interface ClassListLike {
    contains(token: string): boolean;
}

const LIGHT_THEME_CLASSES: readonly string[] = [
    'ivory-mode',
    'serene-mode',
    'github-mode',
];

export function isLightTheme(classList: ClassListLike): boolean {
    return LIGHT_THEME_CLASSES.some(cls => classList.contains(cls));
}

export function getMermaidTheme(classList: ClassListLike): 'default' | 'dark' {
    return isLightTheme(classList) ? 'default' : 'dark';
}
