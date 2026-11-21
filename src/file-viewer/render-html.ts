import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, extname } from "node:path";
import hljs from "highlight.js";
import { Marked, Renderer, type Tokens } from "marked";
import type { DirectoryEntry, FileReadResult, FileSnippetInfo } from "./file-reader.js";
import {
    buildBreadcrumbs,
    buildFileViewerUrl,
    convertFileUriToViewerUrl,
} from "./path-utils.js";

const require = createRequire(import.meta.url);
const HIGHLIGHT_AUTO_MAX_BYTES = 200 * 1024;
const PLAIN_TEXT_EXTENSIONS = new Set([
    ".txt",
    ".log",
    ".env",
    ".csv",
    ".out",
]);

const LANGUAGE_ALIASES: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    mts: "typescript",
    cts: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    sh: "bash",
    zsh: "bash",
    yml: "yaml",
    conf: "nginx",
    service: "ini",
    md: "markdown",
    vue: "xml",
};

export interface ViewerAsset {
    contentType: string;
    body: string;
}

const VIEWER_CSS = `:root {
    color-scheme: light;
    --bg: #ffffff;
    --surface: #f6f8fa;
    --border: #d0d7de;
    --text: #1f2328;
    --muted: #656d76;
    --accent: #0969da;
    --accent-soft: #ddf4ff;
    --line-highlight: #fff8c5;
    --line-highlight-border: #d4a72c;
}
* {
    box-sizing: border-box;
}
html, body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    overflow-x: hidden;
}
a {
    color: var(--accent);
    text-decoration: none;
}
a:hover {
    text-decoration: underline;
}
.topbar {
    position: sticky;
    top: 0;
    z-index: 20;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 10px 14px;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
}
.breadcrumbs {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    overflow-x: auto;
    gap: 4px;
    min-width: 0;
    max-width: 100%;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
    white-space: nowrap;
}
.breadcrumbs a {
    padding: 4px 6px;
    border-radius: 6px;
}
.breadcrumbs a:hover {
    background: rgba(9, 105, 218, 0.08);
    text-decoration: none;
}
.crumb-sep {
    color: var(--muted);
}
.actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
}
.btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 40px;
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--text);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    text-decoration: none;
}
.btn:hover {
    background: #f3f4f6;
    text-decoration: none;
}
.btn[aria-pressed="true"] {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
}
.meta-banner {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 8px 14px;
    color: var(--muted);
    font-size: 13px;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
}
.main {
    padding: 14px;
    max-width: 1200px;
    margin: 0 auto;
}
.notice-card {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.notice-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}
.dir-list {
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
}
.dir-entry {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 44px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
}
.dir-entry:last-child {
    border-bottom: none;
}
.dir-entry-name {
    min-width: 0;
    word-break: break-all;
}
.dir-entry-size {
    color: var(--muted);
    white-space: nowrap;
    font-size: 12px;
}
.dir-entry-broken {
    color: var(--muted);
}
.code-container {
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow-x: auto;
    background: var(--bg);
}
.code-lines {
    display: table;
    width: 100%;
    border-collapse: collapse;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
    line-height: 1.5;
}
.code-row {
    display: table-row;
}
.code-row.is-selected {
    background: var(--line-highlight);
}
.code-row.is-selected .line-num {
    box-shadow: inset 3px 0 0 var(--line-highlight-border);
    color: var(--text);
    font-weight: 600;
}
.line-num {
    display: table-cell;
    width: 1%;
    min-width: 44px;
    padding: 1px 10px;
    text-align: right;
    color: var(--muted);
    user-select: none;
    vertical-align: top;
    border-right: 1px solid var(--border);
    background: var(--surface);
}
.line-num:hover {
    color: var(--accent);
    text-decoration: none;
}
.line-code {
    display: table-cell;
    padding: 1px 12px;
    white-space: pre;
}
.code-container.is-wrapped .line-code {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
}
.markdown-body {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 18px 20px;
    overflow-wrap: anywhere;
}
.markdown-body pre {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px;
    overflow-x: auto;
}
.markdown-body code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
}
.markdown-body table {
    border-collapse: collapse;
    width: 100%;
    display: block;
    overflow-x: auto;
}
.markdown-body th, .markdown-body td {
    border: 1px solid var(--border);
    padding: 6px 10px;
}
@media (max-width: 640px) {
    .main {
        padding: 8px;
    }
    .topbar {
        padding: 8px 10px;
    }
    .actions {
        width: 100%;
    }
    .actions .btn {
        flex: 1 1 auto;
    }
    .line-num {
        min-width: 36px;
        padding: 2px 6px;
    }
    .line-code {
        padding: 2px 8px;
    }
    .markdown-body {
        padding: 12px;
    }
}
`;

const VIEWER_JS = `(function () {
    var codeContainer = document.querySelector(".code-container");
    var wrapBtn = document.querySelector('[data-action="wrap"]');
    var copyBtn = document.querySelector('[data-action="copy"]');
    var anchorStart = null;

    function setWrapped(wrapped) {
        if (!codeContainer || !wrapBtn) return;
        codeContainer.classList.toggle("is-wrapped", wrapped);
        wrapBtn.setAttribute("aria-pressed", wrapped ? "true" : "false");
    }

    if (codeContainer && wrapBtn) {
        setWrapped(window.innerWidth <= 640);
        wrapBtn.addEventListener("click", function () {
            setWrapped(!codeContainer.classList.contains("is-wrapped"));
        });
    }

    function parseLineHash(hash) {
        var m = /^#L(\\d+)(?:-L?(\\d+))?$/i.exec(hash || "");
        if (!m) return null;
        var a = Number(m[1]);
        var b = m[2] ? Number(m[2]) : a;
        return { start: Math.min(a, b), end: Math.max(a, b) };
    }

    function applyHashSelection(shouldScroll) {
        var rows = document.querySelectorAll(".code-row");
        for (var i = 0; i < rows.length; i++) {
            rows[i].classList.remove("is-selected");
        }
        var range = parseLineHash(window.location.hash);
        if (!range) return;
        var firstEl = null;
        for (var line = range.start; line <= range.end; line++) {
            var row = document.getElementById("L" + line);
            if (row) {
                row.classList.add("is-selected");
                if (!firstEl) firstEl = row;
            }
        }
        if (shouldScroll && firstEl) {
            firstEl.scrollIntoView({ block: "center" });
        }
    }

    document.addEventListener("click", function (event) {
        var target = event.target;
        if (!(target instanceof Element)) return;
        var numLink = target.closest(".line-num");
        if (!numLink) return;
        event.preventDefault();
        var line = Number(numLink.getAttribute("data-line"));
        if (!Number.isInteger(line) || line < 1) return;

        var newHash;
        if (event.shiftKey && anchorStart !== null) {
            var low = Math.min(anchorStart, line);
            var high = Math.max(anchorStart, line);
            newHash = low === high ? "#L" + low : "#L" + low + "-L" + high;
        } else {
            anchorStart = line;
            newHash = "#L" + line;
        }
        history.replaceState(null, "", newHash);
        applyHashSelection(false);
    });

    function copyTextWithFallback(text) {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            return navigator.clipboard.writeText(text).catch(function () {
                return legacyCopy(text);
            });
        }
        return Promise.resolve(legacyCopy(text));
    }

    function legacyCopy(text) {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "readonly");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
    }

    if (copyBtn) {
        copyBtn.addEventListener("click", function () {
            var selected = document.querySelectorAll(".code-row.is-selected .line-code");
            var text = "";
            if (selected.length > 0) {
                var parts = [];
                for (var i = 0; i < selected.length; i++) {
                    parts.push(selected[i].textContent || "");
                }
                text = parts.join("\\n");
            } else {
                var rawHolder = document.getElementById("viewer-raw-text");
                if (rawHolder) {
                    text = rawHolder.value || rawHolder.textContent || "";
                }
            }
            copyTextWithFallback(text).then(function () {
                var prev = copyBtn.textContent;
                copyBtn.textContent = "Copied";
                setTimeout(function () {
                    copyBtn.textContent = prev;
                }, 1500);
            });
        });
    }

    window.addEventListener("hashchange", function () {
        applyHashSelection(true);
    });
    applyHashSelection(true);
})();
`;

let cachedHighlightCss: string | null = null;

export function renderFilePage(result: FileReadResult): string {
    if (result.kind === "directory") {
        return renderDirectoryPage(result.resolvedPath, result.entries);
    }
    if (result.kind === "too_large") {
        return renderTooLargePage(result.resolvedPath, result.size, result.maxFileBytes);
    }
    if (result.kind === "binary") {
        return renderBinaryPage(result.resolvedPath, result.size);
    }
    if (result.kind === "download") {
        return renderBinaryPage(result.resolvedPath, result.size);
    }

    const fileName = basename(result.resolvedPath);
    const isMarkdown = isMarkdownFile(result.resolvedPath) && !result.snippet;
    const rawUrl = buildFileViewerUrl(result.resolvedPath, {
        mode: "raw",
    });
    const downloadUrl = buildFileViewerUrl(result.resolvedPath, {
        mode: "download",
    });

    const toolbarButtons = [
        ...(isMarkdown
            ? []
            : [
                  '<button type="button" class="btn" data-action="wrap" aria-pressed="false">Wrap</button>',
              ]),
        '<button type="button" class="btn" data-action="copy">Copy</button>',
        `<a class="btn" href="${escapeHtml(rawUrl)}">Raw</a>`,
        `<a class="btn" href="${escapeHtml(downloadUrl)}">Download</a>`,
    ];

    const bodyHtml = isMarkdown
        ? renderMarkdownContainer(result.content, result.resolvedPath)
        : renderCodeContainer(result.content, result.resolvedPath);

    const snippetBanner = result.snippet
        ? renderSnippetBanner(result.resolvedPath, result.snippet)
        : `<div class="meta-banner"><span>Size: ${formatBytes(result.size)}</span></div>`;

    const hiddenRaw = `<textarea hidden readonly id="viewer-raw-text">${escapeHtml(result.content)}</textarea>`;

    return renderLayout({
        title: fileName,
        targetPath: result.resolvedPath,
        actionsHtml: toolbarButtons.join(""),
        bannerHtml: snippetBanner,
        bodyHtml: `${bodyHtml}${hiddenRaw}`,
    });
}

export function renderDirectoryPage(dirPath: string, entries: DirectoryEntry[]): string {
    const itemsHtml = entries.length === 0
        ? '<div class="notice-card">Directory is empty.</div>'
        : `<div class="dir-list">${entries.map(renderDirectoryEntry).join("")}</div>`;

    return renderLayout({
        title: basename(dirPath) || dirPath,
        targetPath: dirPath,
        actionsHtml: "",
        bannerHtml: `<div class="meta-banner"><span>Directory (${entries.length} items)</span></div>`,
        bodyHtml: itemsHtml,
    });
}

export function renderErrorPage(statusCode: number, message: string): string {
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Error ${statusCode}</title>
    <link rel="stylesheet" href="/files/assets/viewer.css" />
</head>
<body>
    <main class="main">
        <div class="notice-card">
            <strong>Error ${statusCode}</strong>
            <div>${escapeHtml(message)}</div>
        </div>
    </main>
</body>
</html>
`;
}

export async function getViewerAsset(assetName: string): Promise<ViewerAsset | null> {
    if (assetName === "viewer.css") {
        return {
            contentType: "text/css; charset=utf-8",
            body: VIEWER_CSS,
        };
    }
    if (assetName === "viewer.js") {
        return {
            contentType: "application/javascript; charset=utf-8",
            body: VIEWER_JS,
        };
    }
    if (assetName === "highlight.css") {
        const css = await loadHighlightCss();
        return {
            contentType: "text/css; charset=utf-8",
            body: css,
        };
    }
    return null;
}

export function splitHighlightedLines(highlightedHtml: string): string[] {
    const lines: string[] = [];
    const openTags: string[] = [];
    let currentLine = "";
    let index = 0;

    while (index < highlightedHtml.length) {
        const ch = highlightedHtml[index];
        if (ch === "\n") {
            currentLine += "</span>".repeat(openTags.length);
            lines.push(currentLine);
            currentLine = openTags.join("");
            index++;
            continue;
        }

        if (ch === "<") {
            const closeIdx = highlightedHtml.indexOf(">", index);
            if (closeIdx !== -1) {
                const tag = highlightedHtml.slice(index, closeIdx + 1);
                if (tag.startsWith("</")) {
                    openTags.pop();
                } else if (!tag.endsWith("/>")) {
                    openTags.push(tag);
                }
                currentLine += tag;
                index = closeIdx + 1;
                continue;
            }
        }

        currentLine += ch;
        index++;
    }

    lines.push(currentLine + "</span>".repeat(openTags.length));
    if (lines.length > 1 && lines[lines.length - 1] === "") {
        lines.pop();
    }
    return lines;
}

function renderTooLargePage(filePath: string, size: number, maxFileBytes: number): string {
    const headUrl = buildFileViewerUrl(filePath, {
        mode: "head",
    });
    const tailUrl = buildFileViewerUrl(filePath, {
        mode: "tail",
    });
    const downloadUrl = buildFileViewerUrl(filePath, {
        mode: "download",
    });

    const bodyHtml = `<div class="notice-card">
        <div>File size (${formatBytes(size)}) exceeds inline viewer limit (${formatBytes(maxFileBytes)}).</div>
        <div class="notice-actions">
            <a class="btn" href="${escapeHtml(headUrl)}">View Head</a>
            <a class="btn" href="${escapeHtml(tailUrl)}">View Tail</a>
            <a class="btn" href="${escapeHtml(downloadUrl)}">Download File</a>
        </div>
    </div>`;

    return renderLayout({
        title: basename(filePath),
        targetPath: filePath,
        actionsHtml: `<a class="btn" href="${escapeHtml(downloadUrl)}">Download</a>`,
        bannerHtml: `<div class="meta-banner"><span>File too large (${formatBytes(size)})</span></div>`,
        bodyHtml,
    });
}

function renderBinaryPage(filePath: string, size: number): string {
    const downloadUrl = buildFileViewerUrl(filePath, {
        mode: "download",
    });

    const bodyHtml = `<div class="notice-card">
        <div>Binary file (${formatBytes(size)}) cannot be rendered as text.</div>
        <div class="notice-actions">
            <a class="btn" href="${escapeHtml(downloadUrl)}">Download File</a>
        </div>
    </div>`;

    return renderLayout({
        title: basename(filePath),
        targetPath: filePath,
        actionsHtml: `<a class="btn" href="${escapeHtml(downloadUrl)}">Download</a>`,
        bannerHtml: `<div class="meta-banner"><span>Binary file (${formatBytes(size)})</span></div>`,
        bodyHtml,
    });
}

function renderSnippetBanner(filePath: string, snippet: FileSnippetInfo): string {
    const headUrl = buildFileViewerUrl(filePath, {
        mode: "head",
    });
    const tailUrl = buildFileViewerUrl(filePath, {
        mode: "tail",
    });
    return `<div class="meta-banner">
        <span>Showing ${snippet.edge} (${snippet.byteStart}–${snippet.byteEnd} of ${formatBytes(snippet.totalBytes)})</span>
        <a href="${escapeHtml(headUrl)}">Head</a>
        <a href="${escapeHtml(tailUrl)}">Tail</a>
    </div>`;
}

function renderDirectoryEntry(entry: DirectoryEntry): string {
    if (entry.entryType === "broken") {
        return `<div class="dir-entry dir-entry-broken">
            <span class="dir-entry-name">⚠️ ${escapeHtml(entry.name)}</span>
            <span class="dir-entry-size">unreadable</span>
        </div>`;
    }

    const icon = entry.entryType === "directory" ? "📁" : "📄";
    const sizeText = entry.size === null ? "" : formatBytes(entry.size);
    const url = buildFileViewerUrl(entry.fullPath);

    return `<a class="dir-entry" href="${escapeHtml(url)}">
        <span class="dir-entry-name">${icon} ${escapeHtml(entry.name)}</span>
        <span class="dir-entry-size">${sizeText}</span>
    </a>`;
}

function renderCodeContainer(content: string, filePath: string): string {
    const highlighted = highlightText(content, filePath);
    const lines = splitHighlightedLines(highlighted);

    const rowsHtml = lines
        .map((lineHtml, index) => {
            const lineNumber = index + 1;
            const renderedLine = lineHtml.length > 0 ? lineHtml : " ";
            return `<div class="code-row" id="L${lineNumber}"><a class="line-num" href="#L${lineNumber}" data-line="${lineNumber}">${lineNumber}</a><span class="line-code">${renderedLine}</span></div>`;
        })
        .join("\n");

    return `<div class="code-container"><div class="code-lines">${rowsHtml}</div></div>`;
}

function renderMarkdownContainer(content: string, filePath: string): string {
    const baseDir = dirname(filePath);
    const renderer = new Renderer();

    renderer.html = ({ text }: Tokens.HTML | Tokens.Tag): string => {
        return escapeHtml(text);
    };

    renderer.code = ({ text, lang }: Tokens.Code): string => {
        const language = resolveLanguage(lang ? `.${lang.trim().toLowerCase()}` : "");
        const highlighted = language && hljs.getLanguage(language)
            ? hljs.highlight(text, {
                  language,
                  ignoreIllegals: true,
              }).value
            : escapeHtml(text);
        const className = language ? `hljs language-${escapeHtml(language)}` : "hljs";
        return `<pre><code class="${className}">${highlighted}</code></pre>\n`;
    };

    renderer.link = function ({ href, title, tokens }: Tokens.Link): string {
        const safeHref = sanitizeMarkdownHref(href, baseDir);
        const label = this.parser.parseInline(tokens);
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        const externalAttrs = safeHref.startsWith("http://") || safeHref.startsWith("https://")
            ? ' target="_blank" rel="noopener"'
            : "";
        return `<a href="${escapeHtml(safeHref)}"${titleAttr}${externalAttrs}>${label}</a>`;
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
        breaks: false,
        async: false,
    });

    const rendered = marked.parse(content, {
        async: false,
    }) as string;

    return `<article class="markdown-body">${rendered}</article>`;
}

function highlightText(content: string, filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    if (PLAIN_TEXT_EXTENSIONS.has(ext)) {
        return escapeHtml(content);
    }

    const mappedLang = resolveLanguage(ext);
    if (mappedLang && hljs.getLanguage(mappedLang)) {
        return hljs.highlight(content, {
            language: mappedLang,
            ignoreIllegals: true,
        }).value;
    }

    if (Buffer.byteLength(content, "utf8") <= HIGHLIGHT_AUTO_MAX_BYTES) {
        return hljs.highlightAuto(content).value;
    }

    return escapeHtml(content);
}

function resolveLanguage(ext: string): string | null {
    const clean = ext.replace(/^\./, "").toLowerCase();
    if (!clean) {
        return null;
    }
    return LANGUAGE_ALIASES[clean] ?? clean;
}

function sanitizeMarkdownHref(rawHref: string, baseDir: string): string {
    const trimmed = rawHref.trim();
    if (trimmed.length === 0) {
        return "#";
    }
    if (/^file:/i.test(trimmed)) {
        return convertFileUriToViewerUrl(trimmed, baseDir) ?? "#";
    }
    if (trimmed.startsWith("#") || trimmed.startsWith("/")) {
        return trimmed;
    }
    if (/^(https?:|mailto:)/i.test(trimmed)) {
        return trimmed;
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
        return "#";
    }
    const base = baseDir.replace(/\/+$/, "");
    return buildFileViewerUrl(`${base}/${trimmed.replace(/^\.\//, "")}`);
}

function sanitizeImageHref(rawHref: string): string {
    const trimmed = rawHref.trim();
    if (/^(https?:|\/|\.?\/)/i.test(trimmed)) {
        return trimmed;
    }
    if (/^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(trimmed)) {
        return trimmed;
    }
    return "";
}

function renderLayout(params: {
    title: string;
    targetPath: string;
    actionsHtml: string;
    bannerHtml: string;
    bodyHtml: string;
}): string {
    const crumbsHtml = buildBreadcrumbs(params.targetPath)
        .map((crumb) => `<a href="${escapeHtml(crumb.url)}">${escapeHtml(crumb.label)}</a>`)
        .join('<span class="crumb-sep">/</span>');

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(params.title)}</title>
    <link rel="stylesheet" href="/files/assets/highlight.css" />
    <link rel="stylesheet" href="/files/assets/viewer.css" />
    <script defer src="/files/assets/viewer.js"></script>
</head>
<body>
    <header class="topbar">
        <nav class="breadcrumbs">${crumbsHtml}</nav>
        ${params.actionsHtml ? `<div class="actions">${params.actionsHtml}</div>` : ""}
    </header>
    ${params.bannerHtml}
    <main class="main">${params.bodyHtml}</main>
</body>
</html>
`;
}

async function loadHighlightCss(): Promise<string> {
    if (cachedHighlightCss !== null) {
        return cachedHighlightCss;
    }
    const cssPath = require.resolve("highlight.js/styles/github.min.css");
    cachedHighlightCss = await readFile(cssPath, "utf8");
    return cachedHighlightCss;
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function isMarkdownFile(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase();
    return ext === ".md" || ext === ".markdown";
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
