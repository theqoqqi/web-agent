import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AcpRpcClient, JsonRpcResponseError, type RpcTransport } from "../src/acp/rpc-client";
import type { JsonRpcMessage } from "../src/acp/types";

class MockRpcTransport implements RpcTransport {
    readonly sent: JsonRpcMessage[] = [];
    private messageHandler: ((message: JsonRpcMessage) => void) | null = null;
    private closeHandler: (() => void) | null = null;

    send(message: JsonRpcMessage): void {
        this.sent.push(message);
    }

    onMessage(handler: (message: JsonRpcMessage) => void): () => void {
        this.messageHandler = handler;
        return () => {
            this.messageHandler = null;
        };
    }

    onClose(handler: () => void): () => void {
        this.closeHandler = handler;
        return () => {
            this.closeHandler = null;
        };
    }

    emitIncoming(message: JsonRpcMessage): void {
        this.messageHandler?.(message);
    }

    emitClose(): void {
        this.closeHandler?.();
    }
}

describe("AcpRpcClient", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test("коррелирует ответы по id и пробрасывает JsonRpcResponseError с кодом -32000", async () => {
        const transport = new MockRpcTransport();
        const client = new AcpRpcClient(transport);

        const firstPromise = client.request<{ ok: boolean }>("initialize", {});
        const secondPromise = client.request("session/new", { cwd: "/srv" });

        expect(transport.sent).toHaveLength(2);
        const firstReq = transport.sent[0] as { id: number };
        const secondReq = transport.sent[1] as { id: number };

        transport.emitIncoming({
            jsonrpc: "2.0",
            id: secondReq.id,
            error: {
                code: -32000,
                message: "Authentication required",
            },
        });
        transport.emitIncoming({
            jsonrpc: "2.0",
            id: firstReq.id,
            result: { ok: true },
        });

        await expect(firstPromise).resolves.toEqual({ ok: true });
        await expect(secondPromise).rejects.toSatisfy(
            (err: unknown) => err instanceof JsonRpcResponseError && err.code === -32000,
        );
    });

    test("не обрывает session/prompt на 60s, но применяет таймаут к обычным запросам", async () => {
        const transport = new MockRpcTransport();
        const client = new AcpRpcClient(transport);

        const newSessionPromise = client.request("session/new", { cwd: "/srv" });
        const sessionNewExpectation = expect(newSessionPromise).rejects.toThrow(/timeout/i);
        await vi.advanceTimersByTimeAsync(30_000);
        await sessionNewExpectation;

        const promptPromise = client.request<{ stopReason: string }>("session/prompt", {
            sessionId: "s-1",
            prompt: [{ type: "text", text: "Долгая задача" }],
        });

        await vi.advanceTimersByTimeAsync(180_000);

        const promptReq = transport.sent[1] as { id: number };
        transport.emitIncoming({
            jsonrpc: "2.0",
            id: promptReq.id,
            result: { stopReason: "end_turn" },
        });

        await expect(promptPromise).resolves.toEqual({ stopReason: "end_turn" });
    });

    test("отклоняет активные запросы при закрытии транспорта", async () => {
        const transport = new MockRpcTransport();
        const client = new AcpRpcClient(transport);

        const pending = client.request("session/prompt", { sessionId: "s-1" });
        transport.emitClose();

        await expect(pending).rejects.toThrow(/closed/i);
    });

    test("отвечает -32601 на fs/* запросы, маршрутизирует permission request и session/update", async () => {
        const transport = new MockRpcTransport();
        const updates: unknown[] = [];

        new AcpRpcClient(transport, {
            onNotification: (method, params) => {
                if (method === "session/update") {
                    updates.push(params);
                }
            },
            onRequest: async (method) => {
                if (method === "session/request_permission") {
                    return {
                        outcome: {
                            outcome: "selected",
                            optionId: "allow_once",
                        },
                    };
                }
                throw new Error("Unsupported");
            },
        });

        transport.emitIncoming({
            jsonrpc: "2.0",
            id: "req-fs",
            method: "fs/read_text_file",
            params: { path: "/etc/passwd" },
        });
        transport.emitIncoming({
            jsonrpc: "2.0",
            id: "req-perm",
            method: "session/request_permission",
            params: { sessionId: "s-1" },
        });
        transport.emitIncoming({
            jsonrpc: "2.0",
            method: "session/update",
            params: { sessionId: "s-1", update: { sessionUpdate: "agent_message_chunk" } },
        });

        await vi.waitFor(() => {
            expect(transport.sent).toHaveLength(2);
        });

        expect(transport.sent[0]).toEqual({
            jsonrpc: "2.0",
            id: "req-fs",
            error: {
                code: -32601,
                message: "Method not found",
            },
        });
        expect(transport.sent[1]).toEqual({
            jsonrpc: "2.0",
            id: "req-perm",
            result: {
                outcome: {
                    outcome: "selected",
                    optionId: "allow_once",
                },
            },
        });
        expect(updates).toHaveLength(1);
    });

    test("вызывает onUnsolicitedResponse при получении ответа без локального pending промиса", () => {
        const transport = new MockRpcTransport();
        const unsolicited: unknown[] = [];
        new AcpRpcClient(transport, {
            onUnsolicitedResponse: (msg) => {
                unsolicited.push(msg);
            },
        });

        transport.emitIncoming({
            jsonrpc: "2.0",
            id: 999,
            result: { stopReason: "end_turn" },
        });

        expect(unsolicited).toHaveLength(1);
        expect(unsolicited[0]).toEqual({
            jsonrpc: "2.0",
            id: 999,
            result: { stopReason: "end_turn" },
        });
    });
});
