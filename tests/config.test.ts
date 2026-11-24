import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { resolveBridgeConfig } from "../src/config.js";

describe("resolveBridgeConfig", () => {
    const tempDirs: string[] = [];

    function createTempDir(): string {
        const dir = mkdtempSync(join(tmpdir(), "acp-config-test-"));
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

    test("applies secure loopback defaults when minimal valid inputs are provided", () => {
        const sandboxDir = createTempDir();

        const config = resolveBridgeConfig({
            env: {
                ACP_SANDBOX_DIR: sandboxDir,
            },
        });

        expect(config).toEqual({
            host: "127.0.0.1",
            port: 3001,
            wsPath: "/ws",
            command: "agy",
            args: [
                "acp",
            ],
            defaultCwd: sandboxDir,
            shutdownGraceMs: 3000,
            maxLineBytes: 16 * 1024 * 1024,
            heartbeatPingIntervalMs: 30000,
            maxFileBytes: 1024 * 1024,
            viewerSnippetBytes: 100 * 1024,
            detachedTimeoutMs: 15 * 60 * 1000,
            maxReplayBufferLines: 2000,
        });
    });

    test("reads env values and lets explicit overrides take precedence", () => {
        const envDir = createTempDir();
        const overrideDir = createTempDir();

        const config = resolveBridgeConfig({
            env: {
                ACP_BRIDGE_HOST: "localhost",
                ACP_BRIDGE_PORT: "4010",
                ACP_BRIDGE_WS_PATH: "/acp",
                ACP_COMMAND: "/usr/local/bin/agy",
                ACP_ARGS: "acp --sandbox",
                ACP_SANDBOX_DIR: envDir,
                ACP_SHUTDOWN_GRACE_MS: "1500",
                ACP_MAX_LINE_BYTES: "4096",
                ACP_HEARTBEAT_MS: "0",
                ACP_VIEWER_MAX_BYTES: "2048",
                ACP_VIEWER_SNIPPET_BYTES: "512",
                ACP_DETACHED_TIMEOUT_MS: "60000",
                ACP_MAX_REPLAY_BUFFER_LINES: "500",
            },
            overrides: {
                port: 4020,
                defaultCwd: overrideDir,
            },
        });

        expect(config).toEqual({
            host: "localhost",
            port: 4020,
            wsPath: "/acp",
            command: "/usr/local/bin/agy",
            args: [
                "acp",
                "--sandbox",
            ],
            defaultCwd: overrideDir,
            shutdownGraceMs: 1500,
            maxLineBytes: 4096,
            heartbeatPingIntervalMs: 0,
            maxFileBytes: 2048,
            viewerSnippetBytes: 512,
            detachedTimeoutMs: 60000,
            maxReplayBufferLines: 500,
        });
    });

    test("throws when maxFileBytes or viewerSnippetBytes is not positive", () => {
        const sandboxDir = createTempDir();

        expect(() =>
            resolveBridgeConfig({
                env: {
                    ACP_SANDBOX_DIR: sandboxDir,
                    ACP_VIEWER_MAX_BYTES: "0",
                },
            }),
        ).toThrow(/maxFileBytes/i);

        expect(() =>
            resolveBridgeConfig({
                env: {
                    ACP_SANDBOX_DIR: sandboxDir,
                    ACP_VIEWER_SNIPPET_BYTES: "-5",
                },
            }),
        ).toThrow(/viewerSnippetBytes/i);
    });

    test.each([
        "0.0.0.0",
        "172.29.172.1",
        "example.com",
        "",
    ])("throws on non-loopback host %s", (host) => {
        const sandboxDir = createTempDir();

        expect(() =>
            resolveBridgeConfig({
                env: {
                    ACP_BRIDGE_HOST: host,
                    ACP_SANDBOX_DIR: sandboxDir,
                },
            }),
        ).toThrow(/loopback|host/i);
    });

    test.each([
        "0",
        "-1",
        "65536",
        "NaN",
        "3001.5",
        "abc",
    ])("throws on invalid port %s", (port) => {
        const sandboxDir = createTempDir();

        expect(() =>
            resolveBridgeConfig({
                env: {
                    ACP_BRIDGE_PORT: port,
                    ACP_SANDBOX_DIR: sandboxDir,
                },
            }),
        ).toThrow(/port/i);
    });

    test("throws when command is empty", () => {
        const sandboxDir = createTempDir();

        expect(() =>
            resolveBridgeConfig({
                env: {
                    ACP_COMMAND: "   ",
                    ACP_SANDBOX_DIR: sandboxDir,
                },
            }),
        ).toThrow(/command/i);
    });

    test("throws when defaultCwd is missing", () => {
        expect(() =>
            resolveBridgeConfig({
                env: {},
            }),
        ).toThrow(/defaultCwd|directory/i);
    });

    test("throws when defaultCwd does not exist or is a file", () => {
        const dir = createTempDir();
        const filePath = join(dir, "not-a-dir.txt");
        writeFileSync(filePath, "hello", "utf8");

        expect(() =>
            resolveBridgeConfig({
                env: {
                    ACP_SANDBOX_DIR: join(dir, "missing"),
                },
            }),
        ).toThrow(/directory/i);

        expect(() =>
            resolveBridgeConfig({
                env: {
                    ACP_SANDBOX_DIR: filePath,
                },
            }),
        ).toThrow(/directory/i);
    });
});
