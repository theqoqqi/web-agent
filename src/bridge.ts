import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import type { BridgeConfig } from "./config.js";
import { handleFileViewerRequest } from "./file-viewer/handler.js";
import { normalizeClientFrame } from "./message-filter.js";
import { NdjsonLineDecoder } from "./ndjson-framer.js";

const ACP_SUBPROTOCOL = "acp.v1";

export interface BridgeLogger {
    info: (message: string) => void;
    error: (message: string) => void;
}

export interface AcpWsBridge {
    host: string;
    port: number;
    close: () => Promise<void>;
}

export interface CreateAcpWsBridgeOptions {
    env?: NodeJS.ProcessEnv;
    logger?: BridgeLogger;
}

export interface KillableProcess {
    killed: boolean;
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    stdin?: {
        destroyed: boolean;
        end: () => void;
    } | null;
    kill: (signal?: NodeJS.Signals | number) => boolean;
    once: (event: "exit", listener: () => void) => unknown;
    off: (event: "exit", listener: () => void) => unknown;
}

export async function createAcpWsBridge(
    config: BridgeConfig,
    options: CreateAcpWsBridgeOptions = {},
): Promise<AcpWsBridge> {
    const logger = options.logger ?? console;
    const childEnv = options.env ?? process.env;
    const activeCleanups = new Set<() => Promise<void>>();

    const httpServer = createServer((req, res) => {
        void handleFileViewerRequest(req, res, config, logger)
            .then((handled) => {
                if (!handled && !res.headersSent) {
                    res.statusCode = 404;
                    res.end("Not Found");
                }
            })
            .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`[acp-bridge] HTTP request error: ${message}`);
                if (!res.headersSent) {
                    res.statusCode = 500;
                    res.end("Internal Server Error");
                }
            });
    });

    const wss = new WebSocketServer({
        noServer: true,
        maxPayload: config.maxLineBytes,
        handleProtocols,
    });

    httpServer.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        const pathname = extractPathname(req.url);
        if (pathname !== config.wsPath) {
            socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
            socket.destroy();
            return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
        });
    });

    wss.on("connection", (ws) => {
        attachBridgeSession(ws, config, childEnv, logger, activeCleanups);
    });

    const boundPort = await listenHttpServer(httpServer, config.host, config.port);

    return {
        host: config.host,
        port: boundPort,
        close: () => closeBridgeServer(httpServer, wss, activeCleanups),
    };
}

export async function terminateChildProcess(
    proc: KillableProcess,
    graceMs: number,
): Promise<void> {
    if (hasProcessExited(proc)) {
        return;
    }

    if (proc.stdin && !proc.stdin.destroyed) {
        try {
            proc.stdin.end();
        } catch {
            return;
        }
    }

    await new Promise<void>((resolve) => {
        let settled = false;
        let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

        const finish = (): void => {
            if (settled) {
                return;
            }
            settled = true;
            if (forceKillTimer !== undefined) {
                clearTimeout(forceKillTimer);
            }
            proc.off("exit", finish);
            resolve();
        };

        proc.once("exit", finish);

        try {
            const signaled = proc.kill("SIGTERM");
            if (!signaled && hasProcessExited(proc)) {
                finish();
                return;
            }
        } catch {
            finish();
            return;
        }

        if (hasProcessExited(proc)) {
            finish();
            return;
        }

        forceKillTimer = setTimeout(() => {
            if (hasProcessExited(proc)) {
                finish();
                return;
            }
            try {
                proc.kill("SIGKILL");
            } catch {
                finish();
                return;
            }
            if (hasProcessExited(proc)) {
                finish();
            }
        }, graceMs);
    });
}

function handleProtocols(protocols: Set<string>): string | false {
    if (protocols.has(ACP_SUBPROTOCOL)) {
        return ACP_SUBPROTOCOL;
    }
    return false;
}

function extractPathname(rawUrl: string | undefined): string {
    try {
        return new URL(rawUrl ?? "/", "http://127.0.0.1").pathname;
    } catch {
        return "/";
    }
}

function listenHttpServer(server: Server, host: string, port: number): Promise<number> {
    return new Promise((resolve, reject) => {
        const onError = (error: Error): void => {
            server.off("listening", onListening);
            reject(error);
        };

        const onListening = (): void => {
            server.off("error", onError);
            const address = server.address();
            if (!address || typeof address === "string") {
                reject(new Error("Bridge server did not bind to a TCP port"));
                return;
            }
            resolve(address.port);
        };

        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
    });
}

async function closeBridgeServer(
    httpServer: Server,
    wss: WebSocketServer,
    activeCleanups: Set<() => Promise<void>>,
): Promise<void> {
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
            client.close(1001, "Bridge shutting down");
        }
    }

    await Promise.all([
        ...[
            ...activeCleanups,
        ].map((cleanup) => cleanup()),
    ]);

    await new Promise<void>((resolve, reject) => {
        wss.close((wssError) => {
            if (wssError) {
                reject(wssError);
                return;
            }
            httpServer.close((httpError) => {
                if (httpError) {
                    reject(httpError);
                    return;
                }
                resolve();
            });
            httpServer.closeIdleConnections();
        });
    });
}

function attachBridgeSession(
    ws: WebSocket,
    config: BridgeConfig,
    childEnv: NodeJS.ProcessEnv,
    logger: BridgeLogger,
    activeCleanups: Set<() => Promise<void>>,
): void {
    const child = spawn(config.command, config.args, {
        cwd: config.defaultCwd,
        env: childEnv,
        stdio: [
            "pipe",
            "pipe",
            "pipe",
        ],
    });

    const stdoutDecoder = new NdjsonLineDecoder(config.maxLineBytes);
    const stderrDecoder = new StringDecoder("utf8");
    let stderrBuffer = "";
    let cleanupPromise: Promise<void> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    const cleanup = (): Promise<void> => {
        if (cleanupPromise) {
            return cleanupPromise;
        }
        if (pingTimer !== undefined) {
            clearInterval(pingTimer);
            pingTimer = undefined;
        }
        cleanupPromise = terminateChildProcess(child as KillableProcess, config.shutdownGraceMs).finally(
            () => {
                activeCleanups.delete(cleanup);
            },
        );
        return cleanupPromise;
    };

    const isShuttingDown = (): boolean => cleanupPromise !== null;

    activeCleanups.add(cleanup);

    if (config.heartbeatPingIntervalMs > 0) {
        pingTimer = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.ping();
            }
        }, config.heartbeatPingIntervalMs);
    }

    bindChildOutput(
        child,
        ws,
        stdoutDecoder,
        stderrDecoder,
        () => stderrBuffer,
        (next) => {
            stderrBuffer = next;
        },
        isShuttingDown,
        logger,
        cleanup,
    );

    ws.on("message", (data, isBinary) => {
        if (isBinary) {
            closeWebSocket(ws, 1003, "Binary frames are not supported");
            void cleanup();
            return;
        }

        const text = rawDataToString(data);
        let normalized: string | null;
        try {
            normalized = normalizeClientFrame(text);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`[acp-bridge] Invalid client frame: ${message}`);
            closeWebSocket(ws, 1008, "Invalid JSON-RPC frame");
            void cleanup();
            return;
        }

        if (normalized !== null && child.stdin && !child.stdin.destroyed && child.stdin.writable) {
            child.stdin.write(normalized);
        }
    });

    ws.on("close", () => {
        void cleanup();
    });

    ws.on("error", (error) => {
        logger.error(`[acp-bridge] WebSocket error: ${error.message}`);
        void cleanup();
    });
}

function bindChildOutput(
    child: ChildProcess,
    ws: WebSocket,
    stdoutDecoder: NdjsonLineDecoder,
    stderrDecoder: StringDecoder,
    getStderrBuffer: () => string,
    setStderrBuffer: (next: string) => void,
    isShuttingDown: () => boolean,
    logger: BridgeLogger,
    cleanup: () => Promise<void>,
): void {
    if (child.stdout) {
        child.stdout.on("data", (chunk: Buffer) => {
            forwardDecodedOutput(() => stdoutDecoder.push(chunk), ws, logger, cleanup);
        });

        child.stdout.on("end", () => {
            forwardDecodedOutput(() => stdoutDecoder.flush(), ws, logger, cleanup);
        });
    }

    if (child.stderr) {
        child.stderr.on("data", (chunk: Buffer) => {
            const combined = getStderrBuffer() + stderrDecoder.write(chunk);
            const parts = combined.split("\n");
            const tail = parts.pop() ?? "";
            setStderrBuffer(tail);
            for (const part of parts) {
                const trimmed = part.replace(/\r$/, "");
                if (trimmed.length > 0) {
                    logger.error(`[agy stderr] ${trimmed}`);
                }
            }
        });

        child.stderr.on("end", () => {
            const tail = (getStderrBuffer() + stderrDecoder.end()).replace(/\r$/, "");
            setStderrBuffer("");
            if (tail.trim().length > 0) {
                logger.error(`[agy stderr] ${tail}`);
            }
        });
    }

    child.on("error", (error) => {
        logger.error(`[acp-bridge] Failed to run agent process: ${error.message}`);
        closeWebSocket(ws, 1011, "Failed to start agent process");
        void cleanup();
    });

    child.on("exit", (code, signal) => {
        const reason = signal
            ? `Agent exited on signal ${signal}`
            : `Agent exited with code ${code ?? "null"}`;
        if (!isShuttingDown() && code !== 0) {
            logger.error(`[acp-bridge] ${reason}`);
        }
        closeWebSocket(ws, isShuttingDown() || code === 0 ? 1000 : 1011, reason);
        void cleanup();
    });
}

function forwardDecodedOutput(
    decode: () => string[],
    ws: WebSocket,
    logger: BridgeLogger,
    cleanup: () => Promise<void>,
): void {
    try {
        const lines = decode();
        emitLinesToWebSocket(ws, lines);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`[acp-bridge] stdout framing error: ${message}`);
        closeWebSocket(ws, 1009, "Agent frame exceeds maxLineBytes");
        void cleanup();
    }
}

function emitLinesToWebSocket(ws: WebSocket, lines: string[]): void {
    if (ws.readyState !== WebSocket.OPEN) {
        return;
    }
    for (const line of lines) {
        ws.send(line);
    }
}

function closeWebSocket(ws: WebSocket, code: number, reason: string): void {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(code, reason);
    }
}

function rawDataToString(data: RawData): string {
    if (typeof data === "string") {
        return data;
    }
    if (Array.isArray(data)) {
        return Buffer.concat(data).toString("utf8");
    }
    if (Buffer.isBuffer(data)) {
        return data.toString("utf8");
    }
    return Buffer.from(data).toString("utf8");
}

function hasProcessExited(proc: KillableProcess): boolean {
    return proc.killed || proc.exitCode !== null || proc.signalCode !== null;
}
