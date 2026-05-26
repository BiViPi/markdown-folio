import { describe, it, expect } from 'vitest';
import { isLightTheme, getMermaidTheme, type ClassListLike } from '../webview/themeDetection';

/**
 * Phase 1 smoke tests for the Mermaid theme-detection predicate.
 *
 * The predicate today is buggy for `serene` and `github` themes (audit
 * 03-audit #5 + review NEW). These tests document the CURRENT behavior so
 * Phase 2 can update the predicate and the assertions together in a single
 * commit. Each Phase-1-asserts-current-bug case is tagged below.
 */

function classListOf(...classes: string[]): ClassListLike {
    return {
        contains: (token: string) => classes.includes(token),
    };
}

describe('isLightTheme (current Phase 1 behavior)', () => {
    it('returns true for ivory-mode', () => {
        expect(isLightTheme(classListOf('ivory-mode'))).toBe(true);
    });

    it('returns true for sepia-mode (legacy class — not in current CSS but kept by predicate)', () => {
        expect(isLightTheme(classListOf('sepia-mode'))).toBe(true);
    });

    // PHASE-2 FIX TARGET: should return true once predicate is corrected.
    it('returns false for serene-mode (Phase 1: bug preserved; Phase 2 fix flips this)', () => {
        expect(isLightTheme(classListOf('serene-mode'))).toBe(false);
    });

    // PHASE-2 FIX TARGET: should return true once predicate is corrected.
    it('returns false for github-mode (Phase 1: bug preserved; Phase 2 fix flips this)', () => {
        expect(isLightTheme(classListOf('github-mode'))).toBe(false);
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

    it('returns false for an empty class list', () => {
        expect(isLightTheme(classListOf())).toBe(false);
    });
});

describe('getMermaidTheme', () => {
    it('returns "default" for a light class list', () => {
        expect(getMermaidTheme(classListOf('ivory-mode'))).toBe('default');
    });

    it('returns "dark" for a dark class list', () => {
        expect(getMermaidTheme(classListOf('dracula-mode'))).toBe('dark');
    });

    it('returns "dark" when no theme class is present', () => {
        expect(getMermaidTheme(classListOf())).toBe('dark');
    });
});
