import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { FileViewerError, readFileTarget } from "../src/file-viewer/file-reader.js";

describe("readFileTarget", () => {
    const tempDirs: string[] = [];

    function createTempDir(): string {
        const dir = realpathSync(mkdtempSync(join(tmpdir(), "acp-reader-test-")));
        tempDirs.push(dir);
        return dir;
    }

    afterEach(() => {
        while (tempDirs.length > 0) {
            const dir = tempDirs.pop();
            if (dir) {
                rmSync(dir, {
                    recursive: true,
                    force: true,
                });
            }
        }
    });

    test("reads text file within maxFileBytes", async () => {
        const dir = createTempDir();
        const filePath = join(dir, "hello.ts");
        writeFileSync(filePath, "export const x = 42;\n// Привет\n", "utf8");

        const result = await readFileTarget(filePath, "view", {
            maxFileBytes: 1024,
            snippetBytes: 256,
        });

        expect(result).toEqual({
            kind: "text",
            resolvedPath: filePath,
            size: Buffer.byteLength("export const x = 42;\n// Привет\n", "utf8"),
            content: "export const x = 42;\n// Привет\n",
        });
    });

    test("returns too_large for oversized files and reads head/tail snippets cleanly with UTF-8 boundary trimming", async () => {
        const dir = createTempDir();
        const filePath = join(dir, "large.log");
        const content = [
            "001: Привет мир первая строка",
            "002: Вторая строка лога для теста",
            "003: Третья строка лога длинная",
            "004: Четвёртая строка финальная 🚀",
        ].join("\n");
        writeFileSync(filePath, content, "utf8");
        const totalSize = Buffer.byteLength(content, "utf8");

        const tooLarge = await readFileTarget(filePath, "view", {
            maxFileBytes: 40,
            snippetBytes: 75,
        });

        expect(tooLarge).toEqual({
            kind: "too_large",
            resolvedPath: filePath,
            size: totalSize,
            maxFileBytes: 40,
        });

        const headResult = await readFileTarget(filePath, "head", {
            maxFileBytes: 40,
            snippetBytes: 75,
        });

        expect(headResult.kind).toBe("text");
        if (headResult.kind === "text") {
            expect(headResult.content).not.toContain("\uFFFD");
            expect(headResult.content.startsWith("001: Привет")).toBe(true);
            expect(headResult.snippet?.edge).toBe("head");
            expect(headResult.snippet?.totalBytes).toBe(totalSize);
        }

        const tailResult = await readFileTarget(filePath, "tail", {
            maxFileBytes: 40,
            snippetBytes: 75,
        });

        expect(tailResult.kind).toBe("text");
        if (tailResult.kind === "text") {
            expect(tailResult.content).not.toContain("\uFFFD");
            expect(tailResult.content.endsWith("004: Четвёртая строка финальная 🚀")).toBe(true);
            expect(tailResult.snippet?.edge).toBe("tail");
            expect(tailResult.snippet?.totalBytes).toBe(totalSize);
        }
    });

    test("detects binary files by NUL byte unless download mode is requested", async () => {
        const dir = createTempDir();
        const binPath = join(dir, "sample.bin");
        const bytes = Buffer.from([
            0x89,
            0x50,
            0x4e,
            0x47,
            0x00,
            0x0d,
            0x0a,
        ]);
        writeFileSync(binPath, bytes);

        const viewResult = await readFileTarget(binPath, "view", {
            maxFileBytes: 1024,
            snippetBytes: 256,
        });
        expect(viewResult).toEqual({
            kind: "binary",
            resolvedPath: binPath,
            size: bytes.length,
        });

        const downloadResult = await readFileTarget(binPath, "download", {
            maxFileBytes: 1,
            snippetBytes: 1,
        });
        expect(downloadResult).toEqual({
            kind: "download",
            resolvedPath: binPath,
            size: bytes.length,
        });
    });

    test("lists directory entries sorted with directories first and tolerates broken symlinks", async () => {
        const dir = createTempDir();
        mkdirSync(join(dir, "zeta"));
        mkdirSync(join(dir, "alpha"));
        writeFileSync(join(dir, "b.ts"), "123", "utf8");
        writeFileSync(join(dir, ".env"), "SECRET=1", "utf8");
        symlinkSync(join(dir, "missing-target.txt"), join(dir, "broken-link.txt"));

        const result = await readFileTarget(dir, "view", {
            maxFileBytes: 1024,
            snippetBytes: 256,
        });

        expect(result.kind).toBe("directory");
        if (result.kind === "directory") {
            expect(result.entries).toEqual([
                {
                    name: "alpha",
                    fullPath: join(dir, "alpha"),
                    entryType: "directory",
                    size: null,
                },
                {
                    name: "zeta",
                    fullPath: join(dir, "zeta"),
                    entryType: "directory",
                    size: null,
                },
                {
                    name: ".env",
                    fullPath: join(dir, ".env"),
                    entryType: "file",
                    size: 8,
                },
                {
                    name: "b.ts",
                    fullPath: join(dir, "b.ts"),
                    entryType: "file",
                    size: 3,
                },
                {
                    name: "broken-link.txt",
                    fullPath: join(dir, "broken-link.txt"),
                    entryType: "broken",
                    size: null,
                },
            ]);
        }
    });

    test("follows valid symlinks and throws FileViewerError 404 for missing path or 400 for directory download", async () => {
        const dir = createTempDir();
        const target = join(dir, "real.txt");
        const link = join(dir, "alias.txt");
        writeFileSync(target, "linked content", "utf8");
        symlinkSync(target, link);

        const symlinked = await readFileTarget(link, "view", {
            maxFileBytes: 1024,
            snippetBytes: 256,
        });
        expect(symlinked).toEqual({
            kind: "text",
            resolvedPath: target,
            size: 14,
            content: "linked content",
        });

        await expect(
            readFileTarget(join(dir, "no-such-file.txt"), "view", {
                maxFileBytes: 1024,
                snippetBytes: 256,
            }),
        ).rejects.toMatchObject({
            name: "FileViewerError",
            statusCode: 404,
        });

        await expect(
            readFileTarget(dir, "download", {
                maxFileBytes: 1024,
                snippetBytes: 256,
            }),
        ).rejects.toBeInstanceOf(FileViewerError);
    });
});
