import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, test } from "vitest";
import WebSocket from "ws";
import { createAcpWsBridge, terminateChildProcess, type KillableProcess } from "../src/bridge.js";
import type { BridgeConfig } from "../src/config.js";

function createBaseConfig(sandboxDir: string, args: string[], command: string = process.execPath): BridgeConfig {
    return {
        host: "127.0.0.1",
        port: 0,
        wsPath: "/ws",
        command,
        args,
        defaultCwd: sandboxDir,
        shutdownGraceMs: 150,
        maxLineBytes: 1024 * 1024,
        heartbeatPingIntervalMs: 0,
    };
}

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!isProcessAlive(pid)) {
            return true;
        }
        await delay(25);
    }
    return !isProcessAlive(pid);
}

describe("createAcpWsBridge", () => {
    const tempDirs: string[] = [];
    const cleanups: Array<() => Promise<void>> = [];

    function createSandboxDir(): string {
        const dir = realpathSync(mkdtempSync(join(tmpdir(), "acp-bridge-test-")));
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
                rmSync(dir, {
                    recursive: true,
                    force: true,
                });
            }
        }
    });

    test("negotiates acp.v1, preserves large split JSON responses, passes cwd, and drops $/ping", async () => {
        const sandboxDir = createSandboxDir();
        const childScript = `
            let buf = "";
            process.stdin.setEncoding("utf8");
            process.stdin.on("data", (chunk) => {
                buf += chunk;
                while (true) {
                    const idx = buf.indexOf("\\n");
                    if (idx === -1) break;
                    const line = buf.slice(0, idx);
                    buf = buf.slice(idx + 1);
                    if (!line.trim()) continue;
                    const msg = JSON.parse(line);
                    if (msg.method === "big") {
                        const payload = JSON.stringify({
                            jsonrpc: "2.0",
                            id: msg.id,
                            result: {
                                processCwd: process.cwd(),
                                body: "x".repeat(140000),
                            },
                        });
                        const mid = Math.floor(payload.length / 2);
                        process.stdout.write(payload.slice(0, mid));
                        setTimeout(() => {
                            process.stdout.write(payload.slice(mid) + "\\n");
                        }, 15);
                    } else {
                        process.stdout.write(JSON.stringify({
                            jsonrpc: "2.0",
                            id: msg.id ?? null,
                            echoMethod: msg.method,
                            echoParams: msg.params ?? null,
                        }) + "\\n");
                    }
                }
            });
        `;

        const bridge = await createAcpWsBridge(
            createBaseConfig(sandboxDir, [
                "-e",
                childScript,
            ]),
        );
        cleanups.push(() => bridge.close());

        const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/ws`, [
            "acp.v1",
        ]);

        const received: unknown[] = [];
        await new Promise<void>((resolve, reject) => {
            ws.once("open", () => resolve());
            ws.once("error", reject);
        });

        expect(ws.protocol).toBe("acp.v1");

        ws.on("message", (data) => {
            received.push(JSON.parse(data.toString("utf8")));
        });

        ws.send('{"jsonrpc":"2.0","method":"$/ping"}\n');
        ws.send('{"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"/custom/project"}}\n');
        ws.send('{"jsonrpc":"2.0","id":2,"method":"big"}');

        await new Promise<void>((resolve, reject) => {
            const deadline = setTimeout(() => reject(new Error("Timed out waiting for responses")), 5000);
            const timer = setInterval(() => {
                if (received.length >= 2) {
                    clearInterval(timer);
                    clearTimeout(deadline);
                    resolve();
                }
            }, 15);
        });

        await new Promise<void>((resolve) => {
            ws.once("close", () => resolve());
            ws.close();
        });

        expect(received).toHaveLength(2);
        expect(received[0]).toEqual({
            jsonrpc: "2.0",
            id: 1,
            echoMethod: "session/new",
            echoParams: {
                cwd: "/custom/project",
            },
        });

        const bigResponse = received[1] as {
            id: number;
            result: {
                processCwd: string;
                body: string;
            };
        };
        expect(bigResponse.id).toBe(2);
        expect(realpathSync(bigResponse.result.processCwd)).toBe(sandboxDir);
        expect(bigResponse.result.body.length).toBe(140000);
    });

    test("rejects non-matching websocket upgrade path with 404", async () => {
        const sandboxDir = createSandboxDir();
        const bridge = await createAcpWsBridge(
            createBaseConfig(sandboxDir, [
                "-e",
                "setInterval(() => {}, 1000)",
            ]),
        );
        cleanups.push(() => bridge.close());

        const statusCode = await new Promise<number>((resolve, reject) => {
            const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/invalid-path`);
            ws.once("unexpected-response", (_req, res) => {
                res.resume();
                resolve(res.statusCode ?? 0);
            });
            ws.once("open", () => reject(new Error("Should not open on invalid path")));
            ws.once("error", () => {});
        });

        expect(statusCode).toBe(404);
    });

    test("closes connection with 1003 when client sends binary frame", async () => {
        const sandboxDir = createSandboxDir();
        const bridge = await createAcpWsBridge(
            createBaseConfig(sandboxDir, [
                "-e",
                "setInterval(() => {}, 1000)",
            ]),
        );
        cleanups.push(() => bridge.close());

        const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/ws`, [
            "acp.v1",
        ]);
        await new Promise<void>((resolve, reject) => {
            ws.once("open", () => resolve());
            ws.once("error", reject);
        });

        const closeCode = await new Promise<number>((resolve) => {
            ws.once("close", (code) => resolve(code));
            ws.send(Buffer.from([
                0x00,
                0x01,
                0x02,
            ]), {
                binary: true,
            });
        });

        expect(closeCode).toBe(1003);
    });

    test("closes websocket with 1011 when child process fails to spawn or crashes", async () => {
        const sandboxDir = createSandboxDir();
        const bridge = await createAcpWsBridge(
            createBaseConfig(
                sandboxDir,
                [],
                "definitely-nonexistent-acp-binary-9f8e7d",
            ),
        );
        cleanups.push(() => bridge.close());

        const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/ws`, [
            "acp.v1",
        ]);

        const closeCode = await new Promise<number>((resolve) => {
            ws.once("close", (code) => resolve(code));
            ws.once("error", () => {});
        });

        expect(closeCode).toBe(1011);
    });

    test("closes websocket with 1011 when child process exits with non-zero code", async () => {
        const sandboxDir = createSandboxDir();
        const bridge = await createAcpWsBridge(
            createBaseConfig(sandboxDir, [
                "-e",
                "process.exit(2)",
            ]),
        );
        cleanups.push(() => bridge.close());

        const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/ws`, [
            "acp.v1",
        ]);

        const closeCode = await new Promise<number>((resolve) => {
            ws.once("close", (code) => resolve(code));
            ws.once("error", () => {});
        });

        expect(closeCode).toBe(1011);
    });

    test("terminates child process when client disconnects from websocket", async () => {
        const sandboxDir = createSandboxDir();
        const childScript = `
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "ready", params: { pid: process.pid } }) + "\\n");
            setInterval(() => {}, 1000);
        `;
        const bridge = await createAcpWsBridge(
            createBaseConfig(sandboxDir, [
                "-e",
                childScript,
            ]),
        );
        cleanups.push(() => bridge.close());

        const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/ws`, [
            "acp.v1",
        ]);

        const pid = await new Promise<number>((resolve, reject) => {
            ws.once("error", reject);
            ws.once("message", (data) => {
                const parsed = JSON.parse(data.toString("utf8")) as {
                    params: {
                        pid: number;
                    };
                };
                resolve(parsed.params.pid);
            });
        });

        expect(isProcessAlive(pid)).toBe(true);

        await new Promise<void>((resolve) => {
            ws.once("close", () => resolve());
            ws.close();
        });

        const exited = await waitForProcessExit(pid, 3000);
        expect(exited).toBe(true);
    });

    test("escalates from SIGTERM to SIGKILL when process ignores SIGTERM after grace period", async () => {
        const signals: Array<NodeJS.Signals | number | undefined> = [];
        let listeners: Record<string, Array<() => void>> = {};

        const stubbornProcess: KillableProcess = {
            killed: false,
            exitCode: null,
            signalCode: null,
            stdin: {
                destroyed: false,
                end: () => {},
            },
            kill: (signal?: NodeJS.Signals | number) => {
                signals.push(signal);
                if (signal === "SIGKILL") {
                    stubbornProcess.killed = true;
                    stubbornProcess.signalCode = "SIGKILL";
                    for (const cb of listeners.exit ?? []) {
                        cb();
                    }
                }
                return true;
            },
            once: (event: "exit", listener: () => void) => {
                listeners[event] = listeners[event] ?? [];
                listeners[event].push(listener);
                return stubbornProcess;
            },
            off: (event: "exit", listener: () => void) => {
                listeners[event] = (listeners[event] ?? []).filter((fn) => fn !== listener);
                return stubbornProcess;
            },
        };

        await terminateChildProcess(stubbornProcess, 40);

        expect(signals).toEqual([
            "SIGTERM",
            "SIGKILL",
        ]);
    });
});
