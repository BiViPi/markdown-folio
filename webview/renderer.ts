export class Renderer {
    private _container: HTMLElement;

    constructor(containerId: string) {
        this._container = document.getElementById(containerId) || document.body;
    }

    public render(html: string) {
        this._container.innerHTML = html;
    }
}
