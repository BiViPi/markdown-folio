/**
 * ScrollSync — Phase 1: editor → preview forward sync only.
 *
 * Listens for 'scroll-to-line' messages from the extension host and scrolls
 * #document-container to the corresponding anchor element.
 *
 * Uses getBoundingClientRect() instead of offsetTop to handle the
 * transform:scale() on #document-paper correctly at any zoom level.
 */
export class ScrollSync {
    private _container: HTMLElement | null;
    private _index: Array<{ line: number; el: HTMLElement }> = [];
    private _enabled: boolean = true;

    constructor(private vscode: any, containerId: string) {
        this._container = document.getElementById(containerId);

        // Rebuild index when zoom changes (transform:scale shifts all positions)
        document.addEventListener('markdown-folio:zoom-changed', () => {
            this.rebuildIndex();
        });
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
            this._scrollToLine(message.payload.line as number);
        }
    }

    public dispose(): void {
        this._index = [];
    }

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
            // scrollTop + element's position relative to the visible container top
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
