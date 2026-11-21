import { describe, expect, test } from "vitest";
import { NdjsonLineDecoder } from "../src/ndjson-framer.js";

describe("NdjsonLineDecoder", () => {
    test("reassembles a JSON line split across multiple chunks", () => {
        const decoder = new NdjsonLineDecoder(1024);

        const first = decoder.push(Buffer.from('{"jsonrpc":"2.0",', "utf8"));
        const second = decoder.push(Buffer.from('"id":1,"result":{"ok":true}}\n', "utf8"));

        expect(first).toEqual([]);
        expect(second).toEqual([
            '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}',
        ]);
    });

    test("splits multiple newline-delimited frames inside a single chunk and strips CR", () => {
        const decoder = new NdjsonLineDecoder(1024);

        const lines = decoder.push(
            Buffer.from('{"id":1}\r\n  \n\r\n{"id":2}\n', "utf8"),
        );

        expect(lines).toEqual([
            '{"id":1}',
            '{"id":2}',
        ]);
    });

    test("preserves multi-byte UTF-8 characters split across chunk boundaries", () => {
        const decoder = new NdjsonLineDecoder(1024);
        const full = Buffer.from('{"text":"Привет 🚀"}\n', "utf8");
        const cyrillicSplitIndex = full.indexOf("и");
        const partOne = full.subarray(0, cyrillicSplitIndex + 1);
        const partTwo = full.subarray(cyrillicSplitIndex + 1);

        const first = decoder.push(partOne);
        const second = decoder.push(partTwo);

        expect(first).toEqual([]);
        expect(second).toEqual([
            '{"text":"Привет 🚀"}',
        ]);
    });

    test("emits remaining trailing frame on flush when newline is absent", () => {
        const decoder = new NdjsonLineDecoder(1024);

        expect(decoder.push(Buffer.from('{"id":9}', "utf8"))).toEqual([]);
        expect(decoder.flush()).toEqual([
            '{"id":9}',
        ]);
        expect(decoder.flush()).toEqual([]);
    });

    test("throws and clears buffer when incoming line exceeds maxLineBytes", () => {
        const decoder = new NdjsonLineDecoder(16);

        expect(() => decoder.push(Buffer.from('{"long":"1234567890123"}', "utf8"))).toThrow(
            /maxLineBytes/i,
        );
        expect(decoder.push(Buffer.from('{"ok":1}\n', "utf8"))).toEqual([
            '{"ok":1}',
        ]);
    });
});
