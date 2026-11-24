import type {
    JsonRpcErrorObject,
    JsonRpcId,
    JsonRpcMessage,
    JsonRpcNotificationMessage,
    JsonRpcRequestMessage,
    JsonRpcResponseMessage,
} from "./types";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const UNSUPPORTED_METHOD_CODE = -32601;
const INTERNAL_ERROR_CODE = -32603;

const UNSUPPORTED_FS_METHODS = new Set([
    "fs/read_text_file",
    "fs/write_text_file",
]);

export interface RpcTransport {
    send(message: JsonRpcMessage): void;
    onMessage(handler: (message: JsonRpcMessage) => void): () => void;
    onClose(handler: () => void): () => void;
}

export interface AcpRpcClientOptions {
    onNotification?: (method: string, params: unknown) => void;
    onRequest?: (method: string, params: unknown) => Promise<unknown>;
}

export interface RpcRequestOptions {
    timeoutMs?: number | null;
}

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timer: ReturnType<typeof setTimeout> | null;
}

export class JsonRpcResponseError extends Error {
    readonly code: number;
    readonly data?: unknown;

    constructor(message: string, code: number, data?: unknown) {
        super(message);
        this.name = "JsonRpcResponseError";
        this.code = code;
        this.data = data;
    }
}

export class AcpRpcClient {
    private readonly transport: RpcTransport;
    private readonly options: AcpRpcClientOptions;
    private readonly pending = new Map<JsonRpcId, PendingRequest>();
    private readonly unsubscribeMessage: () => void;
    private readonly unsubscribeClose: () => void;
    private nextId = 1;

    constructor(transport: RpcTransport, options: AcpRpcClientOptions = {}) {
        this.transport = transport;
        this.options = options;
        this.unsubscribeMessage = transport.onMessage((message) => {
            this.handleMessage(message);
        });
        this.unsubscribeClose = transport.onClose(() => {
            this.rejectAllPending(new Error("WebSocket connection closed"));
        });
    }

    request<TResult>(
        method: string,
        params?: unknown,
        options: RpcRequestOptions = {},
    ): Promise<TResult> {
        const id = this.nextId;
        this.nextId += 1;

        const timeoutMs = resolveRequestTimeoutMs(method, options.timeoutMs);

        return new Promise<TResult>((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout> | null = null;

            if (timeoutMs !== null && timeoutMs > 0) {
                timer = setTimeout(() => {
                    this.pending.delete(id);
                    reject(new Error(`RPC request timeout (${method}, ${timeoutMs}ms)`));
                }, timeoutMs);
            }

            this.pending.set(id, {
                resolve: resolve as (value: unknown) => void,
                reject,
                timer,
            });

            try {
                this.transport.send({
                    jsonrpc: "2.0",
                    id,
                    method,
                    params,
                });
            } catch (err) {
                if (timer !== null) {
                    clearTimeout(timer);
                }

                this.pending.delete(id);
                reject(err);
            }
        });
    }

    notify(method: string, params?: unknown): void {
        this.transport.send({
            jsonrpc: "2.0",
            method,
            params,
        });
    }

    dispose(): void {
        this.unsubscribeMessage();
        this.unsubscribeClose();
        this.rejectAllPending(new Error("RPC client disposed"));
    }

    private handleMessage(message: JsonRpcMessage): void {
        if (isJsonRpcResponse(message)) {
            this.handleResponse(message);
            return;
        }

        if (isJsonRpcRequest(message)) {
            void this.handleIncomingRequest(message);
            return;
        }

        if (isJsonRpcNotification(message)) {
            this.options.onNotification?.(message.method, message.params);
        }
    }

    private handleResponse(message: JsonRpcResponseMessage): void {
        const pendingEntry = this.pending.get(message.id);

        if (!pendingEntry) {
            return;
        }

        this.pending.delete(message.id);

        if (pendingEntry.timer !== null) {
            clearTimeout(pendingEntry.timer);
        }

        if (message.error) {
            pendingEntry.reject(
                new JsonRpcResponseError(
                    message.error.message,
                    message.error.code,
                    message.error.data,
                ),
            );
            return;
        }

        pendingEntry.resolve(message.result);
    }

    private async handleIncomingRequest(message: JsonRpcRequestMessage): Promise<void> {
        if (UNSUPPORTED_FS_METHODS.has(message.method) || !this.options.onRequest) {
            this.sendErrorResponse(message.id, {
                code: UNSUPPORTED_METHOD_CODE,
                message: "Method not found",
            });
            return;
        }

        try {
            const result = await this.options.onRequest(message.method, message.params);
            this.transport.send({
                jsonrpc: "2.0",
                id: message.id,
                result,
            });
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "Internal error";
            this.sendErrorResponse(message.id, {
                code: INTERNAL_ERROR_CODE,
                message: errorMessage,
            });
        }
    }

    private sendErrorResponse(id: JsonRpcId, error: JsonRpcErrorObject): void {
        try {
            this.transport.send({
                jsonrpc: "2.0",
                id,
                error,
            });
        } catch {
            return;
        }
    }

    private rejectAllPending(error: Error): void {
        for (const [id, entry] of this.pending.entries()) {
            if (entry.timer !== null) {
                clearTimeout(entry.timer);
            }

            this.pending.delete(id);
            entry.reject(error);
        }
    }
}

function resolveRequestTimeoutMs(
    method: string,
    explicitTimeout?: number | null,
): number | null {
    if (explicitTimeout !== undefined) {
        return explicitTimeout;
    }

    if (method === "session/prompt") {
        return null;
    }

    return DEFAULT_REQUEST_TIMEOUT_MS;
}

function isJsonRpcResponse(message: JsonRpcMessage): message is JsonRpcResponseMessage {
    return "id" in message && !("method" in message);
}

function isJsonRpcRequest(message: JsonRpcMessage): message is JsonRpcRequestMessage {
    return "id" in message && "method" in message;
}

function isJsonRpcNotification(
    message: JsonRpcMessage,
): message is JsonRpcNotificationMessage {
    return !("id" in message) && "method" in message;
}
