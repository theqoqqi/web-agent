import hljs from "highlight.js";
import { Marked, Renderer, type Tokens } from "marked";
import { sanitizeHref, sanitizeImageHref } from "./file-links";

export interface RenderMarkdownOptions {
    cwd?: string;
}

export function renderMarkdown(
    content: string,
    options: RenderMarkdownOptions = {},
): string {
    const renderer = new Renderer();

    renderer.html = ({ text }: Tokens.HTML | Tokens.Tag): string => {
        return escapeHtml(text);
    };

    renderer.code = ({ text, lang }: Tokens.Code): string => {
        const cleanLang = normalizeCodeLanguage(lang);
        const highlighted = cleanLang && hljs.getLanguage(cleanLang)
            ? hljs.highlight(text, {
                  language: cleanLang,
                  ignoreIllegals: true,
              }).value
            : escapeHtml(text);
        const langClass = cleanLang ? `hljs language-${escapeHtml(cleanLang)}` : "hljs";
        const langLabel = cleanLang ? escapeHtml(cleanLang) : "text";

        return [
            `<div class="md-code-block">`,
            `<div class="md-code-header">`,
            `<span class="md-code-lang">${langLabel}</span>`,
            `<button type="button" class="md-copy-code-btn">Копировать</button>`,
            `</div>`,
            `<pre><code class="${langClass}">${highlighted}</code></pre>`,
            `</div>`,
        ].join("");
    };

    renderer.link = function ({ href, title, tokens }: Tokens.Link): string {
        const safeHref = sanitizeHref(href, options.cwd);
        const label = this.parser.parseInline(tokens);
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        const targetAttrs = shouldOpenInNewTab(safeHref)
            ? ' target="_blank" rel="noopener noreferrer"'
            : "";

        return `<a href="${escapeHtml(safeHref)}"${titleAttr}${targetAttrs}>${label}</a>`;
    };

    renderer.image = ({ href, title, text }: Tokens.Image): string => {
        const safeSrc = sanitizeImageHref(href);
        const altAttr = ` alt="${escapeHtml(text)}"`;
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";

        return `<img src="${escapeHtml(safeSrc)}"${altAttr}${titleAttr} />`;
    };

    const marked = new Marked({
        renderer,
        gfm: true,
        breaks: true,
        async: false,
    });

    return marked.parse(content, {
        async: false,
    }) as string;
}

function normalizeCodeLanguage(lang?: string): string {
    if (!lang) {
        return "";
    }

    const firstToken = lang.trim().split(/\s+/)[0] ?? "";
    return firstToken.replace(/[^a-zA-Z0-9_+-]/g, "").toLowerCase();
}

function shouldOpenInNewTab(safeHref: string): boolean {
    return (
        safeHref.startsWith("http://") ||
        safeHref.startsWith("https://") ||
        safeHref.startsWith("/files?")
    );
}

function escapeHtml(text: string): string {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
