import { describe, expect, test } from "vitest";
import { renderMarkdown } from "../src/lib/markdown";

describe("renderMarkdown", () => {
    test("преобразует file:/// ссылки напрямую в /files?path=... с target=_blank и rel=noopener noreferrer", () => {
        const html = renderMarkdown("Открой [app.ts](file:///srv/src/app.ts#L10)", {
            cwd: "/srv",
        });

        const container = document.createElement("div");
        container.innerHTML = html;
        const link = container.querySelector("a");

        expect(link).not.toBeNull();
        expect(link?.getAttribute("href")).toBe("/files?path=%2Fsrv%2Fsrc%2Fapp.ts#L10");
        expect(link?.getAttribute("target")).toBe("_blank");
        expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    });

    test("обезвреживает javascript: ссылки, сырой HTML и inline event handlers", () => {
        const html = renderMarkdown(
            '[bad](javascript:alert(1)) <script>alert(1)</script> <img src="x" onerror="alert(1)">',
        );

        const container = document.createElement("div");
        container.innerHTML = html;

        expect(container.querySelector("script")).toBeNull();
        expect(container.querySelector("[onerror]")).toBeNull();

        const link = container.querySelector("a");
        expect(link?.getAttribute("href")).toBe("#");
        expect(container.textContent).toContain("<script>alert(1)</script>");
    });

    test("подсвечивает блоки кода через highlight.js и добавляет кнопку копирования", () => {
        const html = renderMarkdown("```ts\nconst answer: number = 42;\n```");

        const container = document.createElement("div");
        container.innerHTML = html;

        const copyButton = container.querySelector("button.md-copy-code-btn");
        const codeEl = container.querySelector("pre code");
        const langEl = container.querySelector(".md-code-lang");

        expect(copyButton).not.toBeNull();
        expect(langEl?.textContent).toBe("ts");
        expect(codeEl?.className).toContain("hljs");
        expect(codeEl?.className).toContain("language-ts");
        expect(codeEl?.querySelector(".hljs-keyword, .hljs-number")).not.toBeNull();
    });

    test("рендерит GFM таблицы", () => {
        const html = renderMarkdown("| Ключ | Значение |\n| --- | --- |\n| cwd | /srv |");

        const container = document.createElement("div");
        container.innerHTML = html;

        expect(container.querySelectorAll("table th")).toHaveLength(2);
        expect(container.querySelectorAll("table td")).toHaveLength(2);
    });
});
