import mermaid from 'mermaid';

export class Toolbar {
    private _zoom = 1;
    private _orientation: 'portrait' | 'landscape' = 'portrait';
    private _paperSize: 'A4' | 'A3' | 'Letter' = 'A4';

    constructor(private vscode: any) {
        this._initEventListeners();
    }

    private _initEventListeners() {
        const themeToggle = document.getElementById('theme-toggle');
        themeToggle?.addEventListener('click', () => {
            document.body.classList.toggle('light-mode');
            const currentIsLight = document.body.classList.contains('light-mode');

            // Swap icon: sun in light mode, moon in dark mode
            const iconEl = themeToggle.querySelector('svg');
            if (iconEl) {
                iconEl.innerHTML = currentIsLight
                    ? '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
                    : '<path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/>';
            }

            this.vscode.postMessage({
                type: 'update-settings',
                payload: { theme: currentIsLight ? 'light' : 'dark' }
            });

            mermaid.initialize({
                theme: currentIsLight ? 'default' : 'dark',
                startOnLoad: false,
                securityLevel: 'loose'
            });

            document.querySelectorAll('.language-mermaid').forEach(el => {
                el.removeAttribute('data-processed');
            });

            mermaid.run({ querySelector: '.language-mermaid' });
        });

        const exportPdf = document.getElementById('export-pdf');
        exportPdf?.addEventListener('click', () => {
            this.vscode.postMessage({
                type: 'export-pdf',
                payload: {
                    orientation: this._orientation,
                    size: this._paperSize
                }
            });
        });

        document.getElementById('export-html')?.addEventListener('click', () => {
            const isDarkMode = !document.body.classList.contains('light-mode');
            this.vscode.postMessage({ type: 'export-html', payload: { isDarkMode } });
        });

        document.getElementById('export-png-full')?.addEventListener('click', () => {
            this._closeAllDropdowns();
            this.vscode.postMessage({ type: 'export-png-full', payload: {} });
        });

        document.getElementById('export-png-pages')?.addEventListener('click', () => {
            this._closeAllDropdowns();
            this.vscode.postMessage({ type: 'export-png-pages', payload: {} });
        });

        document.getElementById('export-docx')?.addEventListener('click', () => {
            this.vscode.postMessage({ type: 'export-docx', payload: {} });
        });

        this._initDropdown('pdf-dropdown-toggle', 'pdf-dropdown');
        this._initDropdown('png-dropdown-toggle', 'png-dropdown');
        this._initDropdown('settings-dropdown-toggle', 'settings-dropdown');
        this._initPaperOptions();
        this._initSettingsChips();
        this._initZoomControls();

        document.addEventListener('click', () => {
            this._closeAllDropdowns();
        });

        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                this._closeAllDropdowns();
            }
        });
    }

    private _initDropdown(toggleId: string, dropdownId: string) {
        const toggle = document.getElementById(toggleId);
        const dropdown = document.getElementById(dropdownId);
        if (!toggle || !dropdown) {
            return;
        }

        toggle.addEventListener('click', event => {
            event.stopPropagation();
            const willOpen = !dropdown.classList.contains('show');
            this._closeAllDropdowns();
            if (willOpen) {
                dropdown.classList.add('show');
            }
        });

        dropdown.addEventListener('click', event => {
            event.stopPropagation();
        });
    }

    private _initPaperOptions() {
        const orientationButtons = document.querySelectorAll<HTMLElement>('.orient-btn');
        orientationButtons.forEach(button => {
            button.addEventListener('click', () => {
                orientationButtons.forEach(item => item.classList.remove('active'));
                button.classList.add('active');
                this._orientation = (button.dataset.orientation as 'portrait' | 'landscape') || 'portrait';
                this._updateExportBadge();
            });
        });

        const sizeButtons = document.querySelectorAll<HTMLElement>('.size-chip');
        sizeButtons.forEach(button => {
            button.addEventListener('click', () => {
                sizeButtons.forEach(item => item.classList.remove('active'));
                button.classList.add('active');
                this._paperSize = (button.dataset.size as 'A4' | 'A3' | 'Letter') || 'A4';
                this._updateExportBadge();
            });
        });

        this._updateExportBadge();
    }

    private _initSettingsChips() {
        const chips = document.querySelectorAll<HTMLElement>('.set-chip');
        chips.forEach(chip => {
            chip.addEventListener('click', () => {
                const group = chip.dataset.group;
                if (!group) {
                    chip.classList.toggle('active');
                    return;
                }

                const wasActive = chip.classList.contains('active');
                document.querySelectorAll<HTMLElement>(`.set-chip[data-group="${group}"]`).forEach(item => {
                    item.classList.remove('active');
                });

                if (group === 'font') {
                    const fontMap: Record<string, [string, string]> = {
                        'Georgia': ["'Georgia', 'Times New Roman', serif", "'Georgia', 'Times New Roman', serif"],
                        'Inter': ["'Inter', 'Segoe UI', sans-serif", "'Inter', 'Segoe UI', sans-serif"],
                        'Roboto': ["'Roboto', 'Segoe UI', sans-serif", "'Roboto', 'Segoe UI', sans-serif"],
                    };
                    if (wasActive) {
                        // Deselect → reset to defaults
                        document.documentElement.style.removeProperty('--font-body');
                        document.documentElement.style.removeProperty('--font-heading');
                        this.vscode.postMessage({
                            type: 'update-settings',
                            payload: {
                                bodyFont: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
                                headingFont: "'Merriweather', Georgia, serif"
                            }
                        });
                    } else {
                        chip.classList.add('active');
                        const pair = fontMap[chip.textContent?.trim() || ''];
                        if (pair) {
                            document.documentElement.style.setProperty('--font-body', pair[0]);
                            document.documentElement.style.setProperty('--font-heading', pair[1]);
                            this.vscode.postMessage({
                                type: 'update-settings',
                                payload: { bodyFont: pair[0], headingFont: pair[1] }
                            });
                        }
                    }
                    return;
                }

                chip.classList.add('active');

                if (group === 'font-size') {
                    const sizeMap: Record<string, string> = { 'S': '14px', 'M': '16px', 'L': '18px' };
                    const fontSizeNumMap: Record<string, number> = { 'S': 14, 'M': 16, 'L': 18 };
                    const label = chip.textContent?.trim() || '';
                    const size = sizeMap[label];
                    const numSize = fontSizeNumMap[label];
                    if (size && numSize) {
                        document.documentElement.style.setProperty('--font-size-body', size);
                        this.vscode.postMessage({
                            type: 'update-settings',
                            payload: { fontSize: numSize }
                        });
                    }
                }

                if (group === 'heading-size') {
                    const label = chip.textContent?.trim() as 'S' | 'M' | 'L' | undefined;
                    const scaleMap: Record<string, string> = { 'S': '0.8', 'M': '1', 'L': '1.25' };
                    if (label && scaleMap[label]) {
                        document.documentElement.style.setProperty('--heading-scale', scaleMap[label]);
                        this.vscode.postMessage({
                            type: 'update-settings',
                            payload: { headingSize: label }
                        });
                    }
                }
            });
        });

        const toggles = document.querySelectorAll<HTMLElement>('.set-toggle');
        toggles.forEach(toggle => {
            toggle.addEventListener('click', () => {
                toggle.classList.toggle('on');

                if (toggle.dataset.action === 'toc-sidebar') {
                    const sidebar = document.getElementById('sidebar-toc');
                    const isVisible = toggle.classList.contains('on');
                    if (sidebar) {
                        sidebar.style.display = isVisible ? '' : 'none';
                    }
                    this.vscode.postMessage({
                        type: 'update-settings',
                        payload: { showTocSidebar: isVisible }
                    });
                }
            });
        });
    }

    private _initZoomControls() {
        const zoomIn = document.getElementById('zoom-in');
        const zoomOut = document.getElementById('zoom-out');
        const zoomLabel = document.getElementById('zoom-label');

        const applyZoom = () => {
            document.documentElement.style.setProperty('--zoom-scale', this._zoom.toFixed(2));
            if (zoomLabel) {
                zoomLabel.textContent = `${Math.round(this._zoom * 100)}%`;
            }
        };

        zoomIn?.addEventListener('click', () => {
            this._zoom = Math.min(1.8, this._zoom + 0.1);
            applyZoom();
        });

        zoomOut?.addEventListener('click', () => {
            this._zoom = Math.max(0.7, this._zoom - 0.1);
            applyZoom();
        });

        applyZoom();
    }

    public syncFromSettings(settings: {
        fontSize?: number;
        headingSize?: 'S' | 'M' | 'L';
        showTocSidebar?: boolean;
        bodyFont?: string;
    }) {
        // Sync font chips
        if (settings.bodyFont !== undefined) {
            const fontReverseMap: Record<string, string> = {
                "'Georgia', 'Times New Roman', serif": 'Georgia',
                "'Inter', 'Segoe UI', sans-serif": 'Inter',
                "'Roboto', 'Segoe UI', sans-serif": 'Roboto',
            };
            const activeLabel = fontReverseMap[settings.bodyFont];
            document.querySelectorAll<HTMLElement>('.set-chip[data-group="font"]').forEach(chip => {
                chip.classList.toggle('active', chip.textContent?.trim() === activeLabel);
            });
        }

        // Sync font-size chips
        if (settings.fontSize !== undefined) {
            const sizeReverseMap: Record<number, string> = { 14: 'S', 16: 'M', 18: 'L' };
            const label = sizeReverseMap[settings.fontSize];
            if (label) {
                document.querySelectorAll<HTMLElement>('.set-chip[data-group="font-size"]').forEach(chip => {
                    chip.classList.toggle('active', chip.textContent?.trim() === label);
                });
            }
        }

        // Sync heading-size chips
        if (settings.headingSize !== undefined) {
            document.querySelectorAll<HTMLElement>('.set-chip[data-group="heading-size"]').forEach(chip => {
                chip.classList.toggle('active', chip.textContent?.trim() === settings.headingSize);
            });
        }

        // Sync TOC sidebar toggle
        if (settings.showTocSidebar !== undefined) {
            const toggle = document.querySelector<HTMLElement>('.set-toggle[data-action="toc-sidebar"]');
            if (toggle) {
                toggle.classList.toggle('on', settings.showTocSidebar);
            }
        }
    }

    private _updateExportBadge() {
        const badge = document.getElementById('export-pdf-badge');
        if (badge) {
            const orientationLabel = this._orientation === 'portrait' ? 'Portrait' : 'Landscape';
            badge.textContent = `${this._paperSize} · ${orientationLabel}`;
        }
    }

    private _closeAllDropdowns() {
        document.querySelectorAll('.dropdown-menu.show').forEach(dropdown => dropdown.classList.remove('show'));
    }
}
