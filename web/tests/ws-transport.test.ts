import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AcpWsTransport } from "../src/acp/ws-transport";

class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    readonly url: string;
    readonly protocols: string | string[] | undefined;
    readonly sent: string[] = [];
    readyState = FakeWebSocket.CONNECTING;
    closedCalls = 0;

    private listeners = new Map<string, Array<(event: unknown) => void>>();

    constructor(url: string, protocols?: string | string[]) {
        this.url = url;
        this.protocols = protocols;
        FakeWebSocket.instances.push(this);
    }

    static instances: FakeWebSocket[] = [];

    addEventListener(type: string, handler: (event: unknown) => void): void {
        const list = this.listeners.get(type) ?? [];
        list.push(handler);
        this.listeners.set(type, list);
    }

    send(data: string): void {
        this.sent.push(data);
    }

    close(): void {
        this.closedCalls += 1;
        this.readyState = FakeWebSocket.CLOSED;
        this.emit("close", { code: 1000, reason: "" });
    }

    emitOpen(): void {
        this.readyState = FakeWebSocket.OPEN;
        this.emit("open", {});
    }

    emitMessage(data: string): void {
        this.emit("message", { data });
    }

    private emit(type: string, event: unknown): void {
        for (const handler of this.listeners.get(type) ?? []) {
            handler(event);
        }
    }
}

describe("AcpWsTransport", () => {
    beforeEach(() => {
        FakeWebSocket.instances = [];
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    test("подключается с subprotocol acp.v1, отправляет с \\n и сплитит/склеивает NDJSON сообщения", async () => {
        const received: unknown[] = [];
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        const transport = new AcpWsTransport({
            url: "ws://localhost:3001/ws",
            createWebSocket: (url, protocols) =>
                new FakeWebSocket(url, protocols) as unknown as WebSocket,
            onMessage: (msg) => received.push(msg),
        });

        const connectPromise = transport.connect();
        const socket = FakeWebSocket.instances[0];
        expect(socket?.protocols).toBe("acp.v1");

        socket?.emitOpen();
        await connectPromise;

        transport.send({ jsonrpc: "2.0", id: 1, method: "initialize" });
        expect(socket?.sent).toEqual([
            '{"jsonrpc":"2.0","id":1,"method":"initialize"}\n',
        ]);

        socket?.emitMessage(
            '{"jsonrpc":"2.0","id":1}\n{broken-json}\n{"jsonrpc":"2.0","method":"session/',
        );
        socket?.emitMessage('update","params":{}}\n');

        expect(received).toEqual([
            { jsonrpc: "2.0", id: 1 },
            { jsonrpc: "2.0", method: "session/update", params: {} },
        ]);
        expect(warnSpy).toHaveBeenCalledTimes(1);

        transport.close();
    });

    test("отправляет heartbeat $/ping каждые 25000 мс", async () => {
        const transport = new AcpWsTransport({
            url: "ws://localhost:3001/ws",
            createWebSocket: (url, protocols) =>
                new FakeWebSocket(url, protocols) as unknown as WebSocket,
        });

        const connectPromise = transport.connect();
        const socket = FakeWebSocket.instances[0];
        socket?.emitOpen();
        await connectPromise;

        await vi.advanceTimersByTimeAsync(25_000);
        expect(socket?.sent).toEqual([
            '{"jsonrpc":"2.0","method":"$/ping"}\n',
        ]);

        await vi.advanceTimersByTimeAsync(25_000);
        expect(socket?.sent).toHaveLength(2);

        transport.close();
    });

    test("отклоняет connect по таймауту, если сервер не ответил", async () => {
        const transport = new AcpWsTransport({
            url: "ws://localhost:3001/ws",
            connectTimeoutMs: 5_000,
            createWebSocket: (url, protocols) =>
                new FakeWebSocket(url, protocols) as unknown as WebSocket,
        });

        const connectPromise = transport.connect();
        const rejection = expect(connectPromise).rejects.toThrow(/timeout/i);

        await vi.advanceTimersByTimeAsync(5_000);
        await rejection;
        expect(FakeWebSocket.instances[0]?.closedCalls).toBe(1);
    });

    test("обрабатывает одиночные JSON-RPC фреймы от моста без завершающего \\n", async () => {
        const received: unknown[] = [];

        const transport = new AcpWsTransport({
            url: "ws://localhost:3001/ws",
            createWebSocket: (url, protocols) =>
                new FakeWebSocket(url, protocols) as unknown as WebSocket,
            onMessage: (msg) => received.push(msg),
        });

        const connectPromise = transport.connect();
        const socket = FakeWebSocket.instances[0];
        socket?.emitOpen();
        await connectPromise;

        socket?.emitMessage('{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1}}');
        socket?.emitMessage('{"jsonrpc":"2.0","method":"session/update","params":{"ok":true}}');

        expect(received).toEqual([
            { jsonrpc: "2.0", id: 1, result: { protocolVersion: 1 } },
            { jsonrpc: "2.0", method: "session/update", params: { ok: true } },
        ]);

        transport.close();
    });
});
