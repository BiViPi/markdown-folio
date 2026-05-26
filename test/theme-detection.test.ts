import { describe, it, expect } from 'vitest';
import { isLightTheme, getMermaidTheme, type ClassListLike } from '../webview/themeDetection';

/**
 * Phase 2 smoke tests for the Mermaid theme-detection predicate.
 *
 * The Phase 2 fix expands the light set to match the CSS themes actually
 * shipped (`ivory-mode`, `serene-mode`, `github-mode`) and drops the dead
 * `sepia-mode` check. These assertions now describe the corrected behavior.
 */

function classListOf(...classes: string[]): ClassListLike {
    return {
        contains: (token: string) => classes.includes(token),
    };
}

describe('isLightTheme', () => {
    it('returns true for ivory-mode', () => {
        expect(isLightTheme(classListOf('ivory-mode'))).toBe(true);
    });

    it('returns true for serene-mode', () => {
        expect(isLightTheme(classListOf('serene-mode'))).toBe(true);
    });

    it('returns true for github-mode', () => {
        expect(isLightTheme(classListOf('github-mode'))).toBe(true);
    });

    it('returns false for admiral-mode', () => {
        expect(isLightTheme(classListOf('admiral-mode'))).toBe(false);
    });

    it('returns false for cyberpunk-mode', () => {
        expect(isLightTheme(classListOf('cyberpunk-mode'))).toBe(false);
    });

    it('returns false for dracula-mode', () => {
        expect(isLightTheme(classListOf('dracula-mode'))).toBe(false);
    });

    it('returns false for the historic sepia-mode class (no longer in the predicate)', () => {
        expect(isLightTheme(classListOf('sepia-mode'))).toBe(false);
    });

    it('returns false for an empty class list', () => {
        expect(isLightTheme(classListOf())).toBe(false);
    });

    it('returns true when multiple classes are present and one is a light theme', () => {
        expect(isLightTheme(classListOf('show-print-margins', 'github-mode'))).toBe(true);
    });
});

describe('getMermaidTheme', () => {
    it('returns "default" for ivory-mode', () => {
        expect(getMermaidTheme(classListOf('ivory-mode'))).toBe('default');
    });

    it('returns "default" for serene-mode', () => {
        expect(getMermaidTheme(classListOf('serene-mode'))).toBe('default');
    });

    it('returns "default" for github-mode', () => {
        expect(getMermaidTheme(classListOf('github-mode'))).toBe('default');
    });

    it('returns "dark" for admiral-mode', () => {
        expect(getMermaidTheme(classListOf('admiral-mode'))).toBe('dark');
    });

    it('returns "dark" for cyberpunk-mode', () => {
        expect(getMermaidTheme(classListOf('cyberpunk-mode'))).toBe('dark');
    });

    it('returns "dark" for dracula-mode', () => {
        expect(getMermaidTheme(classListOf('dracula-mode'))).toBe('dark');
    });

    it('returns "dark" when no theme class is present', () => {
        expect(getMermaidTheme(classListOf())).toBe('dark');
    });
});
