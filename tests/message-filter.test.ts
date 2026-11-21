import { describe, expect, test } from "vitest";
import { normalizeClientFrame } from "../src/message-filter.js";

describe("normalizeClientFrame", () => {
    test.each([
        {
            name: "ignores empty string",
            input: "",
            expected: null,
        },
        {
            name: "ignores whitespace-only payload",
            input: "   \r\n  ",
            expected: null,
        },
        {
            name: "drops $/ping heartbeat notification without id",
            input: '{"jsonrpc":"2.0","method":"$/ping"}\n',
            expected: null,
        },
        {
            name: "keeps $/ping request when id is present and terminates with single newline",
            input: '{"jsonrpc":"2.0","id":7,"method":"$/ping"}',
            expected: '{"jsonrpc":"2.0","id":7,"method":"$/ping"}\n',
        },
        {
            name: "preserves session/prompt request with single trailing newline",
            input: '{"jsonrpc":"2.0","id":1,"method":"session/prompt","params":{"sessionId":"s1"}}\r\n',
            expected: '{"jsonrpc":"2.0","id":1,"method":"session/prompt","params":{"sessionId":"s1"}}\n',
        },
        {
            name: "strips embedded newlines from formatted JSON-RPC object",
            input: '{\n  "jsonrpc": "2.0",\n  "id": 2,\n  "method": "initialize"\n}',
            expected: '{"jsonrpc":"2.0","id":2,"method":"initialize"}\n',
        },
        {
            name: "preserves client response to agent request",
            input: '{"jsonrpc":"2.0","id":10,"result":{"outcome":{"outcome":"selected","optionId":"allow"}}}',
            expected: '{"jsonrpc":"2.0","id":10,"result":{"outcome":{"outcome":"selected","optionId":"allow"}}}\n',
        },
    ])("$name", ({ input, expected }) => {
        expect(normalizeClientFrame(input)).toBe(expected);
    });

    test.each([
        {
            name: "throws on invalid JSON",
            input: "{broken json",
        },
        {
            name: "throws on JSON array batch",
            input: '[{"jsonrpc":"2.0","id":1,"method":"initialize"}]',
        },
        {
            name: "throws on JSON primitive",
            input: '"just a string"',
        },
    ])("$name", ({ input }) => {
        expect(() => normalizeClientFrame(input)).toThrow();
    });
});
