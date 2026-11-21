import { describe, expect, test } from "vitest";
import {
    getViewerAsset,
    renderDirectoryPage,
    renderErrorPage,
    renderFilePage,
    splitHighlightedLines,
} from "../src/file-viewer/render-html.js";

describe("splitHighlightedLines", () => {
    test("closes and reopens multi-line highlight spans across line breaks", () => {
        const html = '<span class="hljs-comment">/* first line\nsecond line\nthird line */</span>';

        expect(splitHighlightedLines(html)).toEqual([
            '<span class="hljs-comment">/* first line</span>',
            '<span class="hljs-comment">second line</span>',
            '<span class="hljs-comment">third line */</span>',
        ]);
    });
});

describe("file-viewer render-html", () => {
    test("renders source code with clickable line anchors, toolbar actions, and escaped HTML", () => {
        const html = renderFilePage({
            kind: "text",
            resolvedPath: "/root/acp-sandbox/demo.html",
            size: 56,
            content: '<script>alert("xss")</script>\nconst x = 1;',
        });

        expect(html).toContain('name="viewport"');
        expect(html).toContain('href="/files/assets/highlight.css"');
        expect(html).toContain('href="/files/assets/viewer.css"');
        expect(html).toContain('src="/files/assets/viewer.js"');
        expect(html).not.toContain("<script>alert");
        expect(html).toContain('id="L1"');
        expect(html).toContain('href="#L1"');
        expect(html).toContain('id="L2"');
        expect(html).toContain('data-action="wrap"');
        expect(html).toContain('data-action="copy"');
        expect(html).toContain('href="/files?path=%2Froot%2Facp-sandbox%2Fdemo.html&amp;raw=1"');
        expect(html).toContain('href="/files?path=%2Froot%2Facp-sandbox%2Fdemo.html&amp;download=1"');
    });

    test("renders Markdown safely by escaping raw HTML and neutralizing javascript links", () => {
        const markdown = [
            "# Title",
            "",
            '<script>window.pwn = true;</script>',
            '<img src="x" onerror="alert(1)">',
            "",
            "[bad](javascript:alert(1))",
            "[local](file:///root/acp-sandbox/app.ts#L12)",
        ].join("\n");

        const html = renderFilePage({
            kind: "text",
            resolvedPath: "/root/acp-sandbox/README.md",
            size: Buffer.byteLength(markdown, "utf8"),
            content: markdown,
        });

        expect(html).toContain("<h1>Title</h1>");
        expect(html).not.toContain("<script>window.pwn");
        expect(html).not.toContain('onerror="alert(1)"');
        expect(html).toContain("&lt;script&gt;window.pwn = true;&lt;/script&gt;");
        expect(html).not.toContain('href="javascript:alert(1)"');
        expect(html).toContain('href="/files?path=%2Froot%2Facp-sandbox%2Fapp.ts#L12"');
    });

    test("renders directory listing with breadcrumbs and navigation links", () => {
        const html = renderDirectoryPage("/root/acp-sandbox", [
            {
                name: "src",
                fullPath: "/root/acp-sandbox/src",
                entryType: "directory",
                size: null,
            },
            {
                name: "index.ts",
                fullPath: "/root/acp-sandbox/index.ts",
                entryType: "file",
                size: 2048,
            },
            {
                name: "broken-link",
                fullPath: "/root/acp-sandbox/broken-link",
                entryType: "broken",
                size: null,
            },
        ]);

        expect(html).toContain('href="/files?path=%2Froot"');
        expect(html).toContain('href="/files?path=%2Froot%2Facp-sandbox%2Fsrc"');
        expect(html).toContain('href="/files?path=%2Froot%2Facp-sandbox%2Findex.ts"');
        expect(html).toContain("broken-link");
    });

    test("renders head/tail/download links for oversized files and download link for binary files", () => {
        const largeHtml = renderFilePage({
            kind: "too_large",
            resolvedPath: "/var/log/syslog",
            size: 5 * 1024 * 1024,
            maxFileBytes: 1024 * 1024,
        });

        expect(largeHtml).toContain('href="/files?path=%2Fvar%2Flog%2Fsyslog&amp;head=1"');
        expect(largeHtml).toContain('href="/files?path=%2Fvar%2Flog%2Fsyslog&amp;tail=1"');
        expect(largeHtml).toContain('href="/files?path=%2Fvar%2Flog%2Fsyslog&amp;download=1"');

        const binaryHtml = renderFilePage({
            kind: "binary",
            resolvedPath: "/root/archive.bin",
            size: 4096,
        });

        expect(binaryHtml).toContain('href="/files?path=%2Froot%2Farchive.bin&amp;download=1"');
    });

    test("renders escaped error page and serves local assets", async () => {
        const errHtml = renderErrorPage(404, 'Missing <script>alert(1)</script>');
        expect(errHtml).not.toContain("<script>alert(1)</script>");
        expect(errHtml).toContain("404");

        const cssAsset = await getViewerAsset("viewer.css");
        const hlAsset = await getViewerAsset("highlight.css");
        const jsAsset = await getViewerAsset("viewer.js");
        const missingAsset = await getViewerAsset("../secret.js");

        expect(cssAsset?.contentType).toBe("text/css; charset=utf-8");
        expect(hlAsset?.contentType).toBe("text/css; charset=utf-8");
        expect(jsAsset?.contentType).toBe("application/javascript; charset=utf-8");
        expect(jsAsset?.body).toContain("execCommand");
        expect(missingAsset).toBeNull();
    });
});
