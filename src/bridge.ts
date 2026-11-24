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

interface CachedInitializeResponse {
    result?: unknown;
    error?: unknown;
}

interface BridgeReaderSession {
    child: ChildProcess;
    ws: WebSocket;
    requestId: string | number | null;
    cleanup: () => void;
}

interface BridgeSession {
    child: ChildProcess;
    ws: WebSocket | null;
    stdoutDecoder: NdjsonLineDecoder;
    stderrDecoder: StringDecoder;
    stderrBuffer: string;
    cachedInitializeResponse: CachedInitializeResponse | null;
    pendingInitializeRequestId: string | number | null;
    activePromptRequestId: string | number | null;
    activePromptSessionId: string | null;
    pendingPermissionRequest: string | null;
    pendingPermissionRequestId: string | number | null;
    activeReader: BridgeReaderSession | null;
    childEnv: NodeJS.ProcessEnv;
    detachedBuffer: string[];
    detachedTimer: ReturnType<typeof setTimeout> | null;
    pingTimer?: ReturnType<typeof setInterval>;
    cleanupPromise: Promise<void> | null;
    cleanup: () => Promise<void>;
}

export async function createAcpWsBridge(
    config: BridgeConfig,
    options: CreateAcpWsBridgeOptions = {},
): Promise<AcpWsBridge> {
    const logger = options.logger ?? console;
    const childEnv = options.env ?? process.env;
    const activeCleanups = new Set<() => Promise<void>>();
    let currentSession: BridgeSession | null = null;

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
        if (currentSession !== null && !hasProcessExited(currentSession.child as KillableProcess)) {
            reAttachSocketToSession(currentSession, ws, config, logger);
            return;
        }

        currentSession = spawnBridgeSession(
            ws,
            config,
            childEnv,
            logger,
            activeCleanups,
            () => {
                currentSession = null;
            },
        );
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

function reAttachSocketToSession(
    session: BridgeSession,
    ws: WebSocket,
    config: BridgeConfig,
    logger: BridgeLogger,
): void {
    if (session.ws !== null && session.ws !== ws) {
        closeWebSocket(session.ws, 1000, "Superseded by new connection");
    }

    if (session.activeReader !== null) {
        session.activeReader.cleanup();
        session.activeReader = null;
    }

    if (session.detachedTimer !== null) {
        clearTimeout(session.detachedTimer);
        session.detachedTimer = null;
    }

    logger.info(
        `[acp-bridge] Re-attaching client to active session (activePrompt: ${String(session.activePromptRequestId !== null)})`,
    );

    bindSocketToSession(session, ws, config, logger);
}

function spawnBridgeSession(
    initialWs: WebSocket,
    config: BridgeConfig,
    childEnv: NodeJS.ProcessEnv,
    logger: BridgeLogger,
    activeCleanups: Set<() => Promise<void>>,
    onSessionEnd: () => void,
): BridgeSession {
    const child = spawn(config.command, config.args, {
        cwd: config.defaultCwd,
        env: childEnv,
        stdio: [
            "pipe",
            "pipe",
            "pipe",
        ],
    });

    const session: BridgeSession = {
        child,
        ws: initialWs,
        stdoutDecoder: new NdjsonLineDecoder(config.maxLineBytes),
        stderrDecoder: new StringDecoder("utf8"),
        stderrBuffer: "",
        cachedInitializeResponse: null,
        pendingInitializeRequestId: null,
        activePromptRequestId: null,
        activePromptSessionId: null,
        pendingPermissionRequest: null,
        pendingPermissionRequestId: null,
        activeReader: null,
        childEnv,
        detachedBuffer: [],
        detachedTimer: null,
        cleanupPromise: null,
        cleanup: () => Promise.resolve(),
    };

    const cleanup = (): Promise<void> => {
        if (session.cleanupPromise !== null) {
            return session.cleanupPromise;
        }
        if (session.activeReader !== null) {
            session.activeReader.cleanup();
            session.activeReader = null;
        }
        if (session.detachedTimer !== null) {
            clearTimeout(session.detachedTimer);
            session.detachedTimer = null;
        }
        if (session.pingTimer !== undefined) {
            clearInterval(session.pingTimer);
            session.pingTimer = undefined;
        }
        session.cleanupPromise = terminateChildProcess(
            session.child as KillableProcess,
            config.shutdownGraceMs,
        ).finally(() => {
            activeCleanups.delete(cleanup);
            onSessionEnd();
        });
        return session.cleanupPromise;
    };

    session.cleanup = cleanup;
    activeCleanups.add(cleanup);

    if (config.heartbeatPingIntervalMs > 0) {
        session.pingTimer = setInterval(() => {
            if (session.ws !== null && session.ws.readyState === WebSocket.OPEN) {
                session.ws.ping();
            }
        }, config.heartbeatPingIntervalMs);
    }

    bindChildOutput(session, config, logger);
    bindSocketToSession(session, initialWs, config, logger);

    return session;
}

function bindSocketToSession(
    session: BridgeSession,
    ws: WebSocket,
    config: BridgeConfig,
    logger: BridgeLogger,
): void {
    session.ws = ws;

    ws.on("message", (data, isBinary) => {
        if (session.ws !== ws) {
            return;
        }

        if (isBinary) {
            closeWebSocket(ws, 1003, "Binary frames are not supported");
            void session.cleanup();
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
            void session.cleanup();
            return;
        }

        if (normalized === null) {
            return;
        }

        handleClientPayload(session, ws, text, normalized, config, logger);
    });

    ws.on("close", () => {
        if (session.ws !== ws) {
            return;
        }
        handleSocketClose(session, config, logger);
    });

    ws.on("error", (error) => {
        if (session.ws !== ws) {
            return;
        }
        logger.error(`[acp-bridge] WebSocket error: ${error.message}`);
        handleSocketClose(session, config, logger);
    });
}

function handleClientPayload(
    session: BridgeSession,
    ws: WebSocket,
    rawText: string,
    normalized: string,
    config: BridgeConfig,
    logger: BridgeLogger,
): void {
    let payload: Record<string, unknown> | null = null;
    try {
        payload = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
        payload = null;
    }

    const method = typeof payload?.method === "string" ? payload.method : undefined;
    const id = payload?.id as string | number | undefined;

    if (method === "initialize") {
        if (session.cachedInitializeResponse !== null) {
            const response = {
                jsonrpc: "2.0",
                id: id ?? null,
                ...(session.cachedInitializeResponse.error !== undefined
                    ? { error: session.cachedInitializeResponse.error }
                    : { result: session.cachedInitializeResponse.result }),
            };
            ws.send(JSON.stringify(response));
            flushDetachedBuffer(session, ws);
            return;
        }

        session.pendingInitializeRequestId = id ?? null;
    } else if (method === "session/prompt") {
        session.activePromptRequestId = id ?? null;
        session.activePromptSessionId =
            typeof (payload?.params as Record<string, unknown>)?.sessionId === "string"
                ? ((payload?.params as Record<string, unknown>).sessionId as string)
                : null;
    } else if (method === "session/load") {
        const loadParams =
            payload?.params && typeof payload.params === "object"
                ? (payload.params as Record<string, unknown>)
                : {};
        const loadSessionId =
            typeof loadParams.sessionId === "string" ? loadParams.sessionId : null;

        if (
            session.activePromptRequestId !== null &&
            loadSessionId !== null &&
            loadSessionId === session.activePromptSessionId
        ) {
            handleConcurrentSessionLoad(
                session,
                ws,
                id ?? null,
                loadParams,
                config,
                logger,
            );
            return;
        }
    } else if (
        id !== undefined &&
        session.pendingPermissionRequestId !== null &&
        id === session.pendingPermissionRequestId
    ) {
        session.pendingPermissionRequestId = null;
        session.pendingPermissionRequest = null;
    }

    if (
        session.child.stdin &&
        !session.child.stdin.destroyed &&
        session.child.stdin.writable
    ) {
        session.child.stdin.write(normalized);
    }
}

function handleSocketClose(
    session: BridgeSession,
    config: BridgeConfig,
    logger: BridgeLogger,
): void {
    session.ws = null;

    if (session.activeReader !== null) {
        session.activeReader.cleanup();
        session.activeReader = null;
    }

    const shouldDetach =
        session.activePromptRequestId !== null ||
        session.pendingPermissionRequestId !== null;

    if (shouldDetach) {
        logger.info(
            `[acp-bridge] Client disconnected during active session. Entering detached mode (timeout: ${config.detachedTimeoutMs}ms)`,
        );
        if (session.detachedTimer !== null) {
            clearTimeout(session.detachedTimer);
        }
        session.detachedTimer = setTimeout(() => {
            logger.info(
                `[acp-bridge] Detached session timed out after ${config.detachedTimeoutMs}ms. Terminating process.`,
            );
            void session.cleanup();
        }, config.detachedTimeoutMs);
        return;
    }

    void session.cleanup();
}

function bindChildOutput(
    session: BridgeSession,
    config: BridgeConfig,
    logger: BridgeLogger,
): void {
    const { child, stdoutDecoder, stderrDecoder } = session;

    if (child.stdout) {
        child.stdout.on("data", (chunk: Buffer) => {
            forwardDecodedOutput(
                () => stdoutDecoder.push(chunk),
                session,
                config,
                logger,
            );
        });

        child.stdout.on("end", () => {
            forwardDecodedOutput(
                () => stdoutDecoder.flush(),
                session,
                config,
                logger,
            );
        });
    }

    if (child.stderr) {
        child.stderr.on("data", (chunk: Buffer) => {
            const combined = session.stderrBuffer + stderrDecoder.write(chunk);
            const parts = combined.split("\n");
            session.stderrBuffer = parts.pop() ?? "";
            for (const part of parts) {
                const trimmed = part.replace(/\r$/, "");
                if (trimmed.length > 0) {
                    logger.error(`[agy stderr] ${trimmed}`);
                }
            }
        });

        child.stderr.on("end", () => {
            const tail = (session.stderrBuffer + stderrDecoder.end()).replace(/\r$/, "");
            session.stderrBuffer = "";
            if (tail.trim().length > 0) {
                logger.error(`[agy stderr] ${tail}`);
            }
        });
    }

    child.on("error", (error) => {
        logger.error(`[acp-bridge] Failed to run agent process: ${error.message}`);
        if (session.ws !== null) {
            closeWebSocket(session.ws, 1011, "Failed to start agent process");
        }
        void session.cleanup();
    });

    child.on("exit", (code, signal) => {
        const reason = signal
            ? `Agent exited on signal ${signal}`
            : `Agent exited with code ${code ?? "null"}`;
        const isNormalExit = session.cleanupPromise !== null || code === 0;
        if (!isNormalExit) {
            logger.error(`[acp-bridge] ${reason}`);
        }
        if (session.ws !== null) {
            closeWebSocket(session.ws, isNormalExit ? 1000 : 1011, reason);
        }
        void session.cleanup();
    });
}

function forwardDecodedOutput(
    decode: () => string[],
    session: BridgeSession,
    config: BridgeConfig,
    logger: BridgeLogger,
): void {
    try {
        const lines = decode();
        for (const line of lines) {
            handleChildOutputLine(session, line, config);
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`[acp-bridge] stdout framing error: ${message}`);
        if (session.ws !== null) {
            closeWebSocket(session.ws, 1009, "Agent frame exceeds maxLineBytes");
        }
        void session.cleanup();
    }
}

function handleChildOutputLine(
    session: BridgeSession,
    line: string,
    config: BridgeConfig,
): void {
    let message: Record<string, unknown> | null = null;
    try {
        message = JSON.parse(line) as Record<string, unknown>;
    } catch {
        message = null;
    }

    if (message !== null) {
        const id = message.id as string | number | undefined;
        const method = typeof message.method === "string" ? message.method : undefined;

        if (
            id !== undefined &&
            session.pendingInitializeRequestId !== null &&
            id === session.pendingInitializeRequestId
        ) {
            session.cachedInitializeResponse = {
                result: message.result,
                error: message.error,
            };
            session.pendingInitializeRequestId = null;
        }

        if (method === "session/request_permission") {
            session.pendingPermissionRequestId = (id as string | number | null) ?? null;
            session.pendingPermissionRequest = line;
        }

        if (
            id !== undefined &&
            session.activePromptRequestId !== null &&
            id === session.activePromptRequestId
        ) {
            session.activePromptRequestId = null;
            session.activePromptSessionId = null;
        }
    }

    if (session.activeReader !== null) {
        session.detachedBuffer.push(line);
        if (session.detachedBuffer.length > config.maxReplayBufferLines) {
            session.detachedBuffer.shift();
        }
        return;
    }

    if (session.ws !== null && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(line);
        return;
    }

    session.detachedBuffer.push(line);
    if (session.detachedBuffer.length > config.maxReplayBufferLines) {
        session.detachedBuffer.shift();
    }
}

function handleConcurrentSessionLoad(
    session: BridgeSession,
    ws: WebSocket,
    id: string | number | null,
    loadParams: Record<string, unknown>,
    config: BridgeConfig,
    logger: BridgeLogger,
): void {
    if (session.activeReader !== null) {
        session.activeReader.cleanup();
        session.activeReader = null;
    }

    logger.info(
        `[acp-bridge] Spawning reader process for concurrent session/load (sessionId: ${String(session.activePromptSessionId)})`,
    );

    const readerChild = spawn(config.command, config.args, {
        cwd: config.defaultCwd,
        env: session.childEnv,
        stdio: [
            "pipe",
            "pipe",
            "pipe",
        ],
    });

    let isCleanedUp = false;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
        if (isCleanedUp) {
            return;
        }
        isCleanedUp = true;
        if (timeoutTimer !== undefined) {
            clearTimeout(timeoutTimer);
            timeoutTimer = undefined;
        }
        if (!hasProcessExited(readerChild as KillableProcess)) {
            void terminateChildProcess(readerChild as KillableProcess, 1000);
        }
    };

    const readerSession: BridgeReaderSession = {
        child: readerChild,
        ws,
        requestId: id,
        cleanup,
    };
    session.activeReader = readerSession;

    timeoutTimer = setTimeout(() => {
        logger.error("[acp-bridge] Reader process timed out after 15000ms");
        finishReader(session, readerSession);
    }, 15000);

    const stdoutDecoder = new NdjsonLineDecoder(config.maxLineBytes);
    const initRequestId = `__bridge_reader_init_${String(Date.now())}__`;

    readerChild.stdout?.on("data", (chunk: Buffer) => {
        if (isCleanedUp) {
            return;
        }
        try {
            const lines = stdoutDecoder.push(chunk);
            for (const line of lines) {
                handleReaderOutputLine(
                    session,
                    readerSession,
                    line,
                    id,
                    initRequestId,
                    loadParams,
                    logger,
                );
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`[acp-bridge reader] stdout framing error: ${message}`);
            finishReader(session, readerSession);
        }
    });

    readerChild.stdout?.on("end", () => {
        if (isCleanedUp) {
            return;
        }
        try {
            const lines = stdoutDecoder.flush();
            for (const line of lines) {
                handleReaderOutputLine(
                    session,
                    readerSession,
                    line,
                    id,
                    initRequestId,
                    loadParams,
                    logger,
                );
            }
        } catch {
            // ignore flush error on process exit
        }
        finishReader(session, readerSession);
    });

    readerChild.on("error", (err) => {
        logger.error(`[acp-bridge reader] Process error: ${err.message}`);
        finishReader(session, readerSession);
    });

    readerChild.on("exit", () => {
        finishReader(session, readerSession);
    });

    const initPayload = `${JSON.stringify({
        jsonrpc: "2.0",
        id: initRequestId,
        method: "initialize",
        params: {
            protocolVersion: 1,
            clientInfo: {
                name: "web-agent-reader",
                version: "0.1.0",
            },
        },
    })}\n`;

    if (
        readerChild.stdin &&
        !readerChild.stdin.destroyed &&
        readerChild.stdin.writable
    ) {
        readerChild.stdin.write(initPayload);
    }
}

function handleReaderOutputLine(
    session: BridgeSession,
    reader: BridgeReaderSession,
    line: string,
    clientRequestId: string | number | null,
    initRequestId: string,
    loadParams: Record<string, unknown>,
    logger: BridgeLogger,
): void {
    let message: Record<string, unknown> | null = null;
    try {
        message = JSON.parse(line) as Record<string, unknown>;
    } catch {
        message = null;
    }

    if (message !== null) {
        if (message.id === initRequestId) {
            const loadPayload = `${JSON.stringify({
                jsonrpc: "2.0",
                id: clientRequestId,
                method: "session/load",
                params: loadParams,
            })}\n`;
            if (
                reader.child.stdin &&
                !reader.child.stdin.destroyed &&
                reader.child.stdin.writable
            ) {
                reader.child.stdin.write(loadPayload);
            }
            return;
        }

        if (clientRequestId !== null && message.id === clientRequestId) {
            logger.info(
                `[acp-bridge] Reader process completed session/load for ${String(session.activePromptSessionId)}`,
            );
            if (reader.ws.readyState === WebSocket.OPEN) {
                reader.ws.send(line);
            }
            finishReader(session, reader);
            return;
        }

        if (message.method === "session/update") {
            if (reader.ws.readyState === WebSocket.OPEN) {
                reader.ws.send(line);
            }
            return;
        }
    }
}

function finishReader(
    session: BridgeSession,
    reader: BridgeReaderSession,
): void {
    if (session.activeReader !== reader) {
        reader.cleanup();
        return;
    }

    session.activeReader = null;
    reader.cleanup();

    if (reader.ws.readyState === WebSocket.OPEN) {
        flushDetachedBuffer(session, reader.ws);
    }
}

function flushDetachedBuffer(session: BridgeSession, ws: WebSocket): void {
    let sentPendingPermission = false;
    for (const line of session.detachedBuffer) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(line);
            if (
                session.pendingPermissionRequest !== null &&
                line === session.pendingPermissionRequest
            ) {
                sentPendingPermission = true;
            }
        }
    }
    session.detachedBuffer = [];

    if (
        !sentPendingPermission &&
        session.pendingPermissionRequest !== null &&
        ws.readyState === WebSocket.OPEN
    ) {
        ws.send(session.pendingPermissionRequest);
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
