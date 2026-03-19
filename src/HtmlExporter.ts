import * as fs from 'fs';

export class HtmlExporter {
    static export(html: string, outputPath: string): void {
        fs.writeFileSync(outputPath, html, 'utf-8');
    }
}
