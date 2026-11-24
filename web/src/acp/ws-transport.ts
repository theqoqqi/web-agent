import type { JsonRpcMessage } from "./types";

const ACP_SUBPROTOCOL = "acp.v1";
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 25_000;
const WS_OPEN_STATE = 1;

export interface AcpWsTransportOptions {
    url: string;
    connectTimeoutMs?: number;
    heartbeatIntervalMs?: number;
    createWebSocket?: (url: string, protocols: string) => WebSocket;
    onMessage?: (message: JsonRpcMessage) => void;
    onClose?: () => void;
}

export class AcpWsTransport {
    private readonly url: string;
    private readonly connectTimeoutMs: number;
    private readonly heartbeatIntervalMs: number;
    private readonly createWebSocket: (url: string, protocols: string) => WebSocket;
    private readonly messageHandlers = new Set<(message: JsonRpcMessage) => void>();
    private readonly closeHandlers = new Set<() => void>();

    private socket: WebSocket | null = null;
    private lineBuffer = "";
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private manualClose = false;

    constructor(options: AcpWsTransportOptions) {
        this.url = options.url;
        this.connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
        this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
        this.createWebSocket =
            options.createWebSocket ?? ((url, protocol) => new WebSocket(url, protocol));

        if (options.onMessage) {
            this.messageHandlers.add(options.onMessage);
        }

        if (options.onClose) {
            this.closeHandlers.add(options.onClose);
        }
    }

    connect(): Promise<void> {
        if (this.socket && this.socket.readyState === WS_OPEN_STATE) {
            return Promise.resolve();
        }

        this.manualClose = false;
        this.lineBuffer = "";

        return new Promise((resolve, reject) => {
            const ws = this.createWebSocket(this.url, ACP_SUBPROTOCOL);
            this.socket = ws;
            let settled = false;

            const connectTimer = setTimeout(() => {
                if (settled) {
                    return;
                }

                settled = true;
                this.cleanupSocket();
                ws.close();
                reject(new Error("WebSocket connection timeout"));
            }, this.connectTimeoutMs);

            ws.addEventListener("open", () => {
                if (settled) {
                    return;
                }

                settled = true;
                clearTimeout(connectTimer);
                this.startHeartbeat();
                resolve();
            });

            ws.addEventListener("message", (event) => {
                const payload = typeof event.data === "string" ? event.data : "";
                this.handleIncomingChunk(payload);
            });

            ws.addEventListener("error", () => {
                if (!settled) {
                    settled = true;
                    clearTimeout(connectTimer);
                    this.cleanupSocket();
                    reject(new Error("WebSocket connection error"));
                }
            });

            ws.addEventListener("close", () => {
                clearTimeout(connectTimer);

                if (!settled) {
                    settled = true;
                    this.cleanupSocket();
                    reject(new Error("WebSocket closed before open"));
                    return;
                }

                if (this.socket === ws) {
                    this.cleanupSocket();
                    this.notifyClose();
                }
            });
        });
    }

    send(message: unknown): void {
        if (!this.socket || this.socket.readyState !== WS_OPEN_STATE) {
            throw new Error("WebSocket is not open");
        }

        this.socket.send(`${JSON.stringify(message)}\n`);
    }

    close(): void {
        this.manualClose = true;
        const current = this.socket;
        this.cleanupSocket();

        if (current) {
            current.close();
        }
    }

    isOpen(): boolean {
        return this.socket?.readyState === WS_OPEN_STATE;
    }

    isManualClose(): boolean {
        return this.manualClose;
    }

    onMessage(handler: (message: JsonRpcMessage) => void): () => void {
        this.messageHandlers.add(handler);
        return () => {
            this.messageHandlers.delete(handler);
        };
    }

    onClose(handler: () => void): () => void {
        this.closeHandlers.add(handler);
        return () => {
            this.closeHandlers.delete(handler);
        };
    }

    private startHeartbeat(): void {
        this.stopHeartbeat();

        if (this.heartbeatIntervalMs <= 0) {
            return;
        }

        this.heartbeatTimer = setInterval(() => {
            if (this.isOpen()) {
                this.send({
                    jsonrpc: "2.0",
                    method: "$/ping",
                });
            }
        }, this.heartbeatIntervalMs);
    }

    private stopHeartbeat(): void {
        if (this.heartbeatTimer !== null) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    private cleanupSocket(): void {
        this.stopHeartbeat();
        this.socket = null;
        this.lineBuffer = "";
    }

    private handleIncomingChunk(chunk: string): void {
        this.lineBuffer += chunk;

        while (true) {
            const newlineIndex = this.lineBuffer.indexOf("\n");

            if (newlineIndex === -1) {
                break;
            }

            const line = this.lineBuffer.slice(0, newlineIndex).trim();
            this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1);

            if (line.length === 0) {
                continue;
            }

            this.dispatchLine(line);
        }
    }

    private dispatchLine(line: string): void {
        try {
            const parsed = JSON.parse(line) as JsonRpcMessage;

            for (const handler of this.messageHandlers) {
                handler(parsed);
            }
        } catch (err) {
            console.warn("Некорректная NDJSON-строка от ACP:", err);
        }
    }

    private notifyClose(): void {
        for (const handler of this.closeHandlers) {
            handler();
        }
    }
}
