import { mkdtempSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
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
        maxFileBytes: 1024 * 1024,
        viewerSnippetBytes: 100 * 1024,
        detachedTimeoutMs: 15 * 60 * 1000,
        maxReplayBufferLines: 2000,
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
                await removeDirWithRetry(dir);
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

    test("keeps agent process alive during active prompt on disconnect and re-attaches new socket with replayed buffer", async () => {
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
                    if (msg.method === "initialize") {
                        process.stdout.write(JSON.stringify({
                            jsonrpc: "2.0",
                            id: msg.id,
                            result: {
                                protocolVersion: 1,
                                agentCapabilities: {
                                    loadSession: true,
                                },
                            },
                        }) + "\\n");
                    } else if (msg.method === "session/prompt") {
                        process.stdout.write(JSON.stringify({
                            jsonrpc: "2.0",
                            method: "pid_notice",
                            params: {
                                pid: process.pid,
                            },
                        }) + "\\n");
                        setTimeout(() => {
                            process.stdout.write(JSON.stringify({
                                jsonrpc: "2.0",
                                method: "session/update",
                                params: {
                                    chunk: "background-step-1",
                                },
                            }) + "\\n");
                        }, 50);
                        setTimeout(() => {
                            process.stdout.write(JSON.stringify({
                                jsonrpc: "2.0",
                                id: msg.id,
                                result: {
                                    stopReason: "end_turn",
                                },
                            }) + "\\n");
                        }, 120);
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

        const ws1 = new WebSocket(`ws://127.0.0.1:${bridge.port}/ws`, [
            "acp.v1",
        ]);
        await new Promise<void>((resolve, reject) => {
            ws1.once("open", () => resolve());
            ws1.once("error", reject);
        });

        let pid = 0;
        const ws1Promise = new Promise<void>((resolve) => {
            ws1.on("message", (data) => {
                const msg = JSON.parse(data.toString("utf8")) as {
                    method?: string;
                    params?: {
                        pid: number;
                    };
                };
                if (msg.method === "pid_notice" && msg.params) {
                    pid = msg.params.pid;
                    resolve();
                }
            });
        });

        ws1.send('{"jsonrpc":"2.0","id":10,"method":"initialize","params":{}}\n');
        ws1.send('{"jsonrpc":"2.0","id":11,"method":"session/prompt","params":{"prompt":"test"}}\n');

        await ws1Promise;
        expect(isProcessAlive(pid)).toBe(true);

        await new Promise<void>((resolve) => {
            ws1.once("close", () => resolve());
            ws1.close();
        });

        await delay(150);
        expect(isProcessAlive(pid)).toBe(true);

        const ws2 = new WebSocket(`ws://127.0.0.1:${bridge.port}/ws`, [
            "acp.v1",
        ]);
        await new Promise<void>((resolve, reject) => {
            ws2.once("open", () => resolve());
            ws2.once("error", reject);
        });

        const receivedWs2: Array<Record<string, unknown>> = [];
        ws2.on("message", (data) => {
            receivedWs2.push(JSON.parse(data.toString("utf8")));
        });

        ws2.send('{"jsonrpc":"2.0","id":99,"method":"initialize","params":{}}\n');

        await new Promise<void>((resolve, reject) => {
            const deadline = setTimeout(() => reject(new Error("Timed out waiting for re-attached responses")), 3000);
            const timer = setInterval(() => {
                if (receivedWs2.some((m) => m.id === 11)) {
                    clearInterval(timer);
                    clearTimeout(deadline);
                    resolve();
                }
            }, 20);
        });

        expect(receivedWs2[0]).toEqual({
            jsonrpc: "2.0",
            id: 99,
            result: {
                protocolVersion: 1,
                agentCapabilities: {
                    loadSession: true,
                },
            },
        });

        const hasChunk = receivedWs2.some((m) => (m.params as { chunk?: string } | undefined)?.chunk === "background-step-1");
        const hasPromptResult = receivedWs2.some(
            (m) => m.id === 11 && (m.result as { stopReason?: string } | undefined)?.stopReason === "end_turn",
        );
        expect(hasChunk).toBe(true);
        expect(hasPromptResult).toBe(true);

        await new Promise<void>((resolve) => {
            ws2.once("close", () => resolve());
            ws2.close();
        });

        const exited = await waitForProcessExit(pid, 2000);
        expect(exited).toBe(true);
    });

    test("retains pending permission request across client disconnect and forwards decision on re-attach", async () => {
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
                    if (msg.method === "initialize") {
                        process.stdout.write(JSON.stringify({
                            jsonrpc: "2.0",
                            id: msg.id,
                            result: { ok: true },
                        }) + "\\n");
                    } else if (msg.method === "session/prompt") {
                        process.stdout.write(JSON.stringify({
                            jsonrpc: "2.0",
                            id: "perm-42",
                            method: "session/request_permission",
                            params: {
                                toolName: "shell",
                                pid: process.pid,
                            },
                        }) + "\\n");
                    } else if (msg.id === "perm-42") {
                        process.stdout.write(JSON.stringify({
                            jsonrpc: "2.0",
                            id: 1,
                            result: { finishedWith: msg.result?.decision },
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

        const ws1 = new WebSocket(`ws://127.0.0.1:${bridge.port}/ws`, [
            "acp.v1",
        ]);
        await new Promise<void>((resolve, reject) => {
            ws1.once("open", () => resolve());
            ws1.once("error", reject);
        });

        let pid = 0;
        const receivedWs1: Array<Record<string, unknown>> = [];
        const permReceived = new Promise<void>((resolve) => {
            ws1.on("message", (data) => {
                const msg = JSON.parse(data.toString("utf8")) as {
                    id?: string | number;
                    params?: {
                        pid?: number;
                    };
                };
                receivedWs1.push(msg as Record<string, unknown>);
                if (msg.id === "perm-42") {
                    pid = msg.params?.pid ?? 0;
                    resolve();
                }
            });
        });

        ws1.send('{"jsonrpc":"2.0","id":0,"method":"initialize","params":{}}\n');
        ws1.send('{"jsonrpc":"2.0","id":1,"method":"session/prompt","params":{}}\n');
        await permReceived;

        await new Promise<void>((resolve) => {
            ws1.once("close", () => resolve());
            ws1.close();
        });

        const ws2 = new WebSocket(`ws://127.0.0.1:${bridge.port}/ws`, [
            "acp.v1",
        ]);
        await new Promise<void>((resolve, reject) => {
            ws2.once("open", () => resolve());
            ws2.once("error", reject);
        });

        const receivedWs2: Array<Record<string, unknown>> = [];
        const ws2PermPromise = new Promise<void>((resolve) => {
            ws2.on("message", (data) => {
                const msg = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
                receivedWs2.push(msg);
                if (msg.id === "perm-42") {
                    resolve();
                }
            });
        });

        ws2.send('{"jsonrpc":"2.0","id":100,"method":"initialize","params":{}}\n');
        await ws2PermPromise;

        expect(receivedWs2.some((m) => m.id === "perm-42" && m.method === "session/request_permission")).toBe(true);

        const promptFinished = new Promise<void>((resolve) => {
            ws2.on("message", (data) => {
                const msg = JSON.parse(data.toString("utf8")) as Record<string, unknown>;
                if (msg.id === 1) {
                    resolve();
                }
            });
        });

        ws2.send('{"jsonrpc":"2.0","id":"perm-42","result":{"decision":"allow"}}\n');
        await promptFinished;

        const finishMsg = receivedWs2.find((m) => m.id === 1);
        expect(finishMsg).toEqual({
            jsonrpc: "2.0",
            id: 1,
            result: {
                finishedWith: "allow",
            },
        });

        await new Promise<void>((resolve) => {
            ws2.once("close", () => resolve());
            ws2.close();
        });

        const exited = await waitForProcessExit(pid, 2000);
        expect(exited).toBe(true);
    });

    test("terminates detached session after detachedTimeoutMs expires", async () => {
        const sandboxDir = createSandboxDir();
        const childScript = `
            process.stdin.setEncoding("utf8");
            process.stdin.on("data", (chunk) => {
                const msg = JSON.parse(chunk.toString().trim());
                if (msg.method === "session/prompt") {
                    process.stdout.write(JSON.stringify({
                        jsonrpc: "2.0",
                        method: "pid_notice",
                        params: { pid: process.pid },
                    }) + "\\n");
                    setInterval(() => {}, 1000);
                }
            });
        `;

        const config = createBaseConfig(sandboxDir, [
            "-e",
            childScript,
        ]);
        config.detachedTimeoutMs = 120;

        const bridge = await createAcpWsBridge(config);
        cleanups.push(() => bridge.close());

        const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/ws`, [
            "acp.v1",
        ]);
        await new Promise<void>((resolve, reject) => {
            ws.once("open", () => resolve());
            ws.once("error", reject);
        });

        let pid = 0;
        const pidPromise = new Promise<void>((resolve) => {
            ws.on("message", (data) => {
                const msg = JSON.parse(data.toString("utf8")) as {
                    method?: string;
                    params?: {
                        pid: number;
                    };
                };
                if (msg.method === "pid_notice" && msg.params) {
                    pid = msg.params.pid;
                    resolve();
                }
            });
        });

        ws.send('{"jsonrpc":"2.0","id":1,"method":"session/prompt","params":{}}\n');
        await pidPromise;
        expect(isProcessAlive(pid)).toBe(true);

        await new Promise<void>((resolve) => {
            ws.once("close", () => resolve());
            ws.close();
        });

        expect(isProcessAlive(pid)).toBe(true);

        const exited = await waitForProcessExit(pid, 2000);
        expect(exited).toBe(true);
    });

    test("serves concurrent session/load on active session via reader process without cancelling prompt", async () => {
        const sandboxDir = createSandboxDir();
        const childScript = `
            let buf = "";
            let promptActive = false;
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
                    if (msg.method === "initialize") {
                        process.stdout.write(JSON.stringify({
                            jsonrpc: "2.0",
                            id: msg.id,
                            result: { ok: true },
                        }) + "\\n");
                    } else if (msg.method === "session/prompt") {
                        promptActive = true;
                        process.stdout.write(JSON.stringify({
                            jsonrpc: "2.0",
                            method: "session/update",
                            params: { chunk: "step-1" },
                        }) + "\\n");
                        setTimeout(() => {
                            promptActive = false;
                            process.stdout.write(JSON.stringify({
                                jsonrpc: "2.0",
                                id: msg.id,
                                result: { stopReason: "end_turn" },
                            }) + "\\n");
                        }, 150);
                    } else if (msg.method === "session/load") {
                        if (promptActive) {
                            process.stdout.write(JSON.stringify({
                                jsonrpc: "2.0",
                                id: msg.id,
                                error: { message: "Cancelled due to concurrent session/load" },
                            }) + "\\n");
                        } else {
                            process.stdout.write(JSON.stringify({
                                jsonrpc: "2.0",
                                method: "session/update",
                                params: { history: "turn-1" },
                            }) + "\\n");
                            process.stdout.write(JSON.stringify({
                                jsonrpc: "2.0",
                                id: msg.id,
                                result: { loadedSuccessfully: true },
                            }) + "\\n");
                        }
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
        await new Promise<void>((resolve, reject) => {
            ws.once("open", () => resolve());
            ws.once("error", reject);
        });

        const received: Array<Record<string, unknown>> = [];
        ws.on("message", (data) => {
            received.push(JSON.parse(data.toString("utf8")));
        });

        ws.send('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
        ws.send('{"jsonrpc":"2.0","id":2,"method":"session/prompt","params":{"sessionId":"test-session-1","prompt":"hello"}}\n');
        ws.send('{"jsonrpc":"2.0","id":3,"method":"session/load","params":{"sessionId":"test-session-1"}}\n');

        await new Promise<void>((resolve, reject) => {
            const deadline = setTimeout(() => reject(new Error("Timed out waiting for prompt and load reply")), 4000);
            const timer = setInterval(() => {
                if (received.some((m) => m.id === 3) && received.some((m) => m.id === 2)) {
                    clearInterval(timer);
                    clearTimeout(deadline);
                    resolve();
                }
            }, 20);
        });

        const promptIndex = received.findIndex((m) => m.id === 2);
        const loadIndex = received.findIndex((m) => m.id === 3);
        const historyIndex = received.findIndex((m) => (m.params as { history?: string } | undefined)?.history === "turn-1");
        const stepIndex = received.findIndex((m) => (m.params as { chunk?: string } | undefined)?.chunk === "step-1");

        expect(promptIndex).toBeGreaterThan(-1);
        expect(loadIndex).toBeGreaterThan(-1);
        expect(historyIndex).toBeGreaterThan(-1);
        expect(stepIndex).toBeGreaterThan(-1);

        // Historical updates and load reply must arrive before active prompt completes
        expect(historyIndex).toBeLessThan(loadIndex);
        expect(loadIndex).toBeLessThan(promptIndex);

        const promptReply = received[promptIndex];
        const loadReply = received[loadIndex];
        expect((promptReply?.result as { stopReason?: string } | undefined)?.stopReason).toBe("end_turn");
        expect((loadReply?.result as { loadedSuccessfully?: boolean } | undefined)?.loadedSuccessfully).toBe(true);
        expect(loadReply?.error).toBeUndefined();

        await new Promise<void>((resolve) => {
            ws.once("close", () => resolve());
            ws.close();
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
