import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import {
    buildBreadcrumbs,
    buildContentDisposition,
    buildFileViewerUrl,
    convertFileUriToViewerUrl,
    parseFileViewerQuery,
    resolveLocationPathToViewerUrl,
} from "../src/file-viewer/path-utils.js";

describe("file-viewer path-utils", () => {
    test("parses /files query params and defaults to defaultCwd when path is omitted", () => {
        const defaultDir = resolve("/tmp/acp-sandbox");

        expect(parseFileViewerQuery("/files", defaultDir)).toEqual({
            targetPath: defaultDir,
            mode: "view",
        });

        expect(
            parseFileViewerQuery("/files?path=%2Froot%2Fapp.ts&raw=1", defaultDir),
        ).toEqual({
            targetPath: resolve("/root/app.ts"),
            mode: "raw",
        });

        expect(
            parseFileViewerQuery("/files?path=%2Fvar%2Flog%2Fapp.log&tail=1", defaultDir),
        ).toEqual({
            targetPath: resolve("/var/log/app.log"),
            mode: "tail",
        });

        expect(
            parseFileViewerQuery("/files?path=%2Ftmp%2Fa.bin&download=1", defaultDir),
        ).toEqual({
            targetPath: resolve("/tmp/a.bin"),
            mode: "download",
        });

        expect(
            parseFileViewerQuery("/files?path=%2Ftmp%2Fbig.log&head=1", defaultDir),
        ).toEqual({
            targetPath: resolve("/tmp/big.log"),
            mode: "head",
        });
    });

    test("throws when path query parameter is explicitly blank or contains NUL bytes", () => {
        const defaultDir = resolve("/tmp/acp-sandbox");

        expect(() => parseFileViewerQuery("/files?path=%20%20", defaultDir)).toThrow(
            /path/i,
        );

        expect(() => parseFileViewerQuery("/files?path=%2Ftmp%2Fbad%00.txt", defaultDir)).toThrow(
            /nul|invalid/i,
        );
    });

    test("builds viewer URLs without double encoding and preserves line hash", () => {
        expect(
            buildFileViewerUrl("/root/my project/тест.ts", {
                mode: "view",
                hash: "#L10-L20",
            }),
        ).toBe("/files?path=%2Froot%2Fmy%20project%2F%D1%82%D0%B5%D1%81%D1%82.ts#L10-L20");

        expect(
            buildFileViewerUrl("/var/log/out.log", {
                mode: "tail",
            }),
        ).toBe("/files?path=%2Fvar%2Flog%2Fout.log&tail=1");
    });

    test("converts file:// URIs to /files URLs preserving line hashes and spaces", () => {
        expect(
            convertFileUriToViewerUrl("file:///root/acp-sandbox/my%20file.ts#L10-L20"),
        ).toBe("/files?path=%2Froot%2Facp-sandbox%2Fmy%20file.ts#L10-L20");

        expect(
            convertFileUriToViewerUrl("file:///C:/Users/demo/src/app.ts#L5"),
        ).toBe("/files?path=C%3A%2FUsers%2Fdemo%2Fsrc%2Fapp.ts#L5");

        expect(
            convertFileUriToViewerUrl("file://src/index.ts#L12", "/root/acp-sandbox"),
        ).toBe("/files?path=%2Froot%2Facp-sandbox%2Fsrc%2Findex.ts#L12");

        expect(convertFileUriToViewerUrl("https://example.com/a.ts")).toBeNull();
    });

    test("resolves ToolCallCard location strings with emoji and optional line suffix", () => {
        expect(
            resolveLocationPathToViewerUrl("📁 /root/acp-sandbox/index.html"),
        ).toBe("/files?path=%2Froot%2Facp-sandbox%2Findex.html");

        expect(
            resolveLocationPathToViewerUrl("  📁 src/main.ts#L14-L18 ", "/root/acp-sandbox"),
        ).toBe("/files?path=%2Froot%2Facp-sandbox%2Fsrc%2Fmain.ts#L14-L18");

        expect(
            resolveLocationPathToViewerUrl("📁 src/main.ts:42", "/root/acp-sandbox"),
        ).toBe("/files?path=%2Froot%2Facp-sandbox%2Fsrc%2Fmain.ts#L42");

        expect(resolveLocationPathToViewerUrl("📁 src/main.ts")).toBeNull();
        expect(resolveLocationPathToViewerUrl("   ")).toBeNull();
    });

    test("builds clickable breadcrumbs for nested POSIX paths", () => {
        expect(buildBreadcrumbs("/root/acp-sandbox/app.ts")).toEqual([
            {
                label: "/",
                url: "/files?path=%2F",
            },
            {
                label: "root",
                url: "/files?path=%2Froot",
            },
            {
                label: "acp-sandbox",
                url: "/files?path=%2Froot%2Facp-sandbox",
            },
            {
                label: "app.ts",
                url: "/files?path=%2Froot%2Facp-sandbox%2Fapp.ts",
            },
        ]);
    });

    test("builds safe Content-Disposition header for Cyrillic, quotes, and newlines", () => {
        expect(buildContentDisposition('/root/отчёт "2026"\r\n.txt')).toBe(
            "attachment; filename=\"_______2026_.txt\"; filename*=UTF-8''%D0%BE%D1%82%D1%87%D1%91%D1%82%20%222026%22.txt",
        );
    });
});
