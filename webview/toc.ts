import { TocItem } from '../src/shared/types';

export class Toc {
    private _container: HTMLElement;
    private _observer: IntersectionObserver | null = null;

    constructor(containerId: string) {
        this._container = document.getElementById(containerId) || document.body;
    }

    public render(tocItems: TocItem[]) {
        if (tocItems.length === 0) {
            this._container.innerHTML = '<div style="padding: 20px; color: var(--text-muted);">No headings found.</div>';
            return;
        }

        const html = tocItems
            .map(item => `
                <div class="toc-item level-${item.level}" data-slug="${item.slug}">
                    ${item.text.normalize('NFC')}
                </div>
            `)
            .join('');

        this._container.innerHTML = `
            <div class="toc-header">Contents</div>
            ${html}
        `;

        this._initEventListeners();
        this._bindScrollSync();
    }

    private _initEventListeners() {
        this._container.querySelectorAll('.toc-item').forEach(item => {
            item.addEventListener('click', () => {
                const slug = item.getAttribute('data-slug');
                const element = document.getElementById(slug!);
                if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    this._setActiveSlug(slug || '');
                }
            });
        });
    }

    private _bindScrollSync() {
        if (this._observer) {
            this._observer.disconnect();
            this._observer = null;
        }

        const headings = document.querySelectorAll<HTMLElement>('#document-content h1, #document-content h2, #document-content h3, #document-content h4, #document-content h5, #document-content h6');
        if (headings.length === 0) {
            return;
        }

        const scrollRoot = document.getElementById('document-container');
        this._observer = new IntersectionObserver(
            entries => {
                const visible = entries
                    .filter(entry => entry.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

                if (visible.length > 0) {
                    const id = (visible[0].target as HTMLElement).id;
                    if (id) {
                        this._setActiveSlug(id);
                    }
                }
            },
            {
                root: scrollRoot,
                threshold: 0.1,
                rootMargin: '-10% 0px -60% 0px'
            }
        );

        headings.forEach(heading => this._observer?.observe(heading));
    }

    private _setActiveSlug(slug: string) {
        this._container.querySelectorAll<HTMLElement>('.toc-item').forEach(item => {
            const isActive = item.dataset.slug === slug;
            item.classList.toggle('active', isActive);
            if (isActive) {
                item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        });
    }
}
