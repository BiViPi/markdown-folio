/**
 * ScrollSync — Phase 1 + Phase 2
 *
 * Phase 1: listens for 'scroll-to-line' messages from extension host → scrolls preview.
 * Phase 2: listens to container scroll events → posts 'reveal-line' to extension host.
 *
 * Loop guard: when a 'scroll-to-line' arrives we suppress reverse sync briefly
 * to prevent the editor → preview → editor → … feedback loop.
 *
 * Uses getBoundingClientRect() instead of offsetTop to handle
 * transform:scale() on #document-paper correctly at any zoom level.
 */
export class ScrollSync {
    private _container: HTMLElement | null;
    private _index: Array<{ line: number; el: HTMLElement }> = [];
    private _enabled: boolean = true;

    // Phase 2: loop guard fields
    private _lastInboundTimestamp = 0;
    private _suppressRevealUntil = 0;
    private _revealEventCounter = 0;
    private _debounceRevealTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private vscode: any, containerId: string) {
        this._container = document.getElementById(containerId);

        // Rebuild index when zoom changes (transform:scale shifts all positions)
        document.addEventListener('markdown-folio:zoom-changed', () => {
            this.rebuildIndex();
        });

        // Phase 2: listen to preview scroll, debounce 100ms, post reveal-line
        this._container?.addEventListener('scroll', () => {
            this._onContainerScroll();
        }, { passive: true });
    }

    /** Rebuild anchor index from current DOM state. Call after render and after Mermaid. */
    public rebuildIndex(): void {
        if (!this._container) { return; }
        const anchors = this._container.querySelectorAll<HTMLElement>('[data-source-line]');
        this._index = Array.from(anchors)
            .map(el => ({
                line: parseInt(el.getAttribute('data-source-line') ?? '0', 10),
                el
            }))
            .sort((a, b) => a.line - b.line);
    }

    /** Enable or disable scroll sync without destroying the instance. */
    public setEnabled(value: boolean): void {
        this._enabled = value;
    }

    /** Route messages from the extension host. */
    public handleMessage(message: any): void {
        if (!this._enabled) { return; }
        if (message.type === 'scroll-to-line') {
            // Record inbound timestamp for loop guard BEFORE scrolling
            this._lastInboundTimestamp = Date.now();
            this._suppressRevealUntil = Date.now() + 900;
            this._scrollToLine(message.payload.line as number);
        }
    }

    public dispose(): void {
        this._index = [];
        if (this._debounceRevealTimer) {
            clearTimeout(this._debounceRevealTimer);
            this._debounceRevealTimer = null;
        }
    }

    // ─── Phase 2 ────────────────────────────────────────────────────────────

    private _onContainerScroll(): void {
        if (!this._enabled) { return; }
        if (Date.now() < this._suppressRevealUntil) { return; }

        // Debounce: only fire 100ms after scroll stops
        if (this._debounceRevealTimer) {
            clearTimeout(this._debounceRevealTimer);
        }
        this._debounceRevealTimer = setTimeout(() => {
            this._debounceRevealTimer = null;
            this._emitRevealLine();
        }, 100);
    }

    private _emitRevealLine(): void {
        if (!this._enabled) { return; }

        // Loop guard: suppress if a scroll-to-line arrived very recently.
        if (Date.now() < this._suppressRevealUntil || Date.now() - this._lastInboundTimestamp < 200) { return; }

        const line = this._findTopAnchorLine();
        if (line === null) { return; }

        this.vscode.postMessage({
            type: 'reveal-line',
            payload: { line, eventId: ++this._revealEventCounter }
        });
    }

    /** Find the source line of the anchor element closest to (and at/above) the visible top. */
    private _findTopAnchorLine(): number | null {
        const container = this._container;
        if (!container || this._index.length === 0) { return null; }

        const containerRect = container.getBoundingClientRect();
        const toolbarOffset = this._getToolbarOffset(containerRect);
        const viewportTop = containerRect.top + toolbarOffset;

        // Find the last anchor whose top is <= viewportTop (i.e., at or above current scroll top)
        let best: { line: number; el: HTMLElement } | null = null;
        for (const anchor of this._index) {
            const r = anchor.el.getBoundingClientRect();
            if (r.top <= viewportTop + 16) { // +16px tolerance
                best = anchor;
            } else {
                break;
            }
        }

        return best ? best.line : this._index[0]?.line ?? null;
    }

    // ─── Phase 1 ────────────────────────────────────────────────────────────

    private _scrollToLine(targetLine: number): void {
        const container = this._container;
        if (!container || this._index.length === 0) { return; }

        // Find low anchor (largest line ≤ targetLine) and high (smallest line > targetLine)
        let low: { line: number; el: HTMLElement } | undefined;
        let high: { line: number; el: HTMLElement } | undefined;

        for (const anchor of this._index) {
            if (anchor.line <= targetLine) {
                low = anchor;
            } else {
                high = anchor;
                break;
            }
        }

        if (!low) {
            // Target is before all anchors — scroll to top
            container.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }

        const containerRect = container.getBoundingClientRect();
        const toolbarOffset = this._getToolbarOffset(containerRect);

        const positionOf = (el: HTMLElement): number => {
            const r = el.getBoundingClientRect();
            return container.scrollTop + (r.top - containerRect.top) - toolbarOffset;
        };

        let targetTop: number;
        if (!high || low.line === high.line) {
            targetTop = positionOf(low.el);
        } else {
            const fraction = (targetLine - low.line) / (high.line - low.line);
            const lowPos = positionOf(low.el);
            const highPos = positionOf(high.el);
            targetTop = lowPos + fraction * (highPos - lowPos);
        }

        container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
    }

    private _getToolbarOffset(containerRect: DOMRect): number {
        const toolbar = document.getElementById('toolbar');
        if (!toolbar || toolbar.style.display === 'none') {
            return 0;
        }

        const rect = toolbar.getBoundingClientRect();
        if (rect.height === 0) {
            return 0;
        }

        return Math.max(0, rect.bottom - containerRect.top + 12);
    }
}
