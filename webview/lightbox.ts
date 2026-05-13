export class Lightbox {
    private _abortController: AbortController | null = null;
    private _overlay: HTMLElement | null = null;
    private _keydownHandler: ((e: KeyboardEvent) => void) | null = null;

    /** Call after each render to rebind click handlers on the document content. */
    attach(container: HTMLElement): void {
        this.detach();
        this._abortController = new AbortController();
        container.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.tagName !== 'IMG') { return; }
            // Skip SVG diagrams wrapped in tikz-diagram (those are not <img> anyway,
            // but this guard is defensive in case they ever become <img> tags).
            if (target.closest('.tikz-diagram')) { return; }
            e.preventDefault();
            this._open(target as HTMLImageElement);
        }, { signal: this._abortController.signal });
    }

    /** Remove event listener and close any open overlay. */
    detach(): void {
        this._abortController?.abort();
        this._abortController = null;
        this._close();
    }

    private _open(img: HTMLImageElement): void {
        this._close();

        const overlay = document.createElement('div');
        overlay.className = 'lightbox-overlay';

        const frame = document.createElement('div');
        frame.className = 'lightbox-frame';

        const bigImg = document.createElement('img');
        bigImg.src = img.src;
        bigImg.alt = img.alt;

        frame.appendChild(bigImg);
        overlay.appendChild(frame);
        document.body.appendChild(overlay);
        this._overlay = overlay;

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target === frame) { this._close(); }
        });

        this._keydownHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') { this._close(); }
        };
        document.addEventListener('keydown', this._keydownHandler);

        // Trigger fade-in on next frame so CSS transition fires.
        requestAnimationFrame(() => overlay.classList.add('lightbox-visible'));
    }

    private _close(): void {
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
            this._keydownHandler = null;
        }
        this._overlay?.remove();
        this._overlay = null;
    }
}
