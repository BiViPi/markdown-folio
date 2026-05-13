declare module 'html-to-docx' {
    interface HtmlToDocxOptions {
        title?: string;
        font?: string;
        fontSize?: number;
        margins?: {
            top?: number;
            bottom?: number;
            left?: number;
            right?: number;
            header?: number;
            footer?: number;
            gutter?: number;
        };
        table?: {
            row?: {
                cantSplit?: boolean;
            };
        };
    }

    export default function HTMLtoDOCX(
        html: string,
        headerHtml?: string,
        options?: HtmlToDocxOptions
    ): Promise<Buffer>;
}
