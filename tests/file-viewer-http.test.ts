import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, test } from "vitest";
import WebSocket from "ws";
import { createAcpWsBridge } from "../src/bridge.js";
import type { BridgeConfig } from "../src/config.js";

function createTestConfig(sandboxDir: string): BridgeConfig {
    return {
        host: "127.0.0.1",
        port: 0,
        wsPath: "/ws",
        command: process.execPath,
        args: [
            "-e",
            `
            process.stdin.on("data", (d) => {
                process.stdout.write(d);
            });
            process.stdin.on("end", () => {
                process.exit(0);
            });
            `,
        ],
        defaultCwd: sandboxDir,
        shutdownGraceMs: 150,
        maxLineBytes: 1024 * 1024,
        heartbeatPingIntervalMs: 0,
        maxFileBytes: 1024 * 1024,
        viewerSnippetBytes: 100 * 1024,
    };
}

describe("file-viewer HTTP endpoints inside createAcpWsBridge", () => {
    const tempDirs: string[] = [];
    const cleanups: Array<() => Promise<void>> = [];

    function createSandboxDir(): string {
        const dir = realpathSync(mkdtempSync(join(tmpdir(), "acp-http-viewer-")));
        tempDirs.push(dir);
        return dir;
    }

    afterEach(async () => {
        while (cleanups.length > 0) {
            const cleanup = cleanups.pop();
            if (cleanup) {
                await cleanup();
            }
        }
        while (tempDirs.length > 0) {
            const dir = tempDirs.pop();
            if (dir) {
                await removeDirWithRetry(dir);
            }
        }
    });

    test("serves HTML view with strict CSP, raw text, streaming download, and directory default", async () => {
        const sandboxDir = createSandboxDir();
        const samplePath = join(sandboxDir, "app.ts");
        writeFileSync(samplePath, "export const answer = 42;\n", "utf8");

        const bridge = await createAcpWsBridge(createTestConfig(sandboxDir));
        cleanups.push(() => bridge.close());
        const baseUrl = `http://127.0.0.1:${bridge.port}`;

        const dirResponse = await fetch(`${baseUrl}/files`);
        expect(dirResponse.status).toBe(200);
        expect(dirResponse.headers.get("content-type")).toContain("text/html");
        expect(dirResponse.headers.get("x-content-type-options")).toBe("nosniff");
        const dirCsp = dirResponse.headers.get("content-security-policy") ?? "";
        expect(dirCsp).toContain("script-src 'self'");
        expect(dirCsp).not.toContain("unsafe-inline");
        const dirHtml = await dirResponse.text();
        expect(dirHtml).toContain("app.ts");

        const fileResponse = await fetch(
            `${baseUrl}/files?path=${encodeURIComponent(samplePath)}`,
        );
        expect(fileResponse.status).toBe(200);
        expect(fileResponse.headers.get("content-security-policy")).toContain("default-src 'none'");
        const fileHtml = await fileResponse.text();
        expect(fileHtml).toContain("answer");
        expect(fileHtml).toContain('id="L1"');

        const rawResponse = await fetch(
            `${baseUrl}/files?path=${encodeURIComponent(samplePath)}&raw=1`,
        );
        expect(rawResponse.status).toBe(200);
        expect(rawResponse.headers.get("content-type")).toBe("text/plain; charset=utf-8");
        expect(rawResponse.headers.get("x-content-type-options")).toBe("nosniff");
        expect(await rawResponse.text()).toBe("export const answer = 42;\n");

        const downloadResponse = await fetch(
            `${baseUrl}/files?path=${encodeURIComponent(samplePath)}&download=1`,
        );
        expect(downloadResponse.status).toBe(200);
        expect(downloadResponse.headers.get("content-disposition")).toContain("attachment");
        expect(downloadResponse.headers.get("x-content-type-options")).toBe("nosniff");
        expect(await downloadResponse.text()).toBe("export const answer = 42;\n");
    });

    test("serves local viewer CSS/JS assets and returns 404/405 for invalid routes or missing files", async () => {
        const sandboxDir = createSandboxDir();
        const bridge = await createAcpWsBridge(createTestConfig(sandboxDir));
        cleanups.push(() => bridge.close());
        const baseUrl = `http://127.0.0.1:${bridge.port}`;

        const viewerCss = await fetch(`${baseUrl}/files/assets/viewer.css`);
        expect(viewerCss.status).toBe(200);
        expect(viewerCss.headers.get("content-type")).toBe("text/css; charset=utf-8");

        const highlightCss = await fetch(`${baseUrl}/files/assets/highlight.css`);
        expect(highlightCss.status).toBe(200);
        expect(highlightCss.headers.get("content-type")).toBe("text/css; charset=utf-8");

        const viewerJs = await fetch(`${baseUrl}/files/assets/viewer.js`);
        expect(viewerJs.status).toBe(200);
        expect(viewerJs.headers.get("content-type")).toBe("application/javascript; charset=utf-8");

        const missingFile = await fetch(
            `${baseUrl}/files?path=${encodeURIComponent(join(sandboxDir, "missing.txt"))}`,
        );
        expect(missingFile.status).toBe(404);

        const unknownRoute = await fetch(`${baseUrl}/unknown`);
        expect(unknownRoute.status).toBe(404);

        const postFiles = await fetch(`${baseUrl}/files`, {
            method: "POST",
        });
        expect(postFiles.status).toBe(405);
    });

    test("keeps /ws websocket upgrade working alongside /files HTTP endpoints", async () => {
        const sandboxDir = createSandboxDir();
        const bridge = await createAcpWsBridge(createTestConfig(sandboxDir));
        cleanups.push(() => bridge.close());

        const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/ws`, [
            "acp.v1",
        ]);
        await new Promise<void>((resolve, reject) => {
            ws.once("open", () => resolve());
            ws.once("error", reject);
        });

        const reply = await new Promise<string>((resolve) => {
            ws.once("message", (data) => resolve(data.toString("utf8")));
            ws.send('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
        });

        await new Promise<void>((resolve) => {
            ws.once("close", () => resolve());
            ws.close();
        });

        expect(JSON.parse(reply)).toEqual({
            jsonrpc: "2.0",
            id: 1,
            method: "ping",
        });
    });
});

async function removeDirWithRetry(dirPath: string): Promise<void> {
    const maxAttempts = 20;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await rm(dirPath, {
                recursive: true,
                force: true,
            });
            return;
        } catch (error) {
            if (attempt === maxAttempts) {
                throw error;
            }
            await delay(50);
        }
    }
}
