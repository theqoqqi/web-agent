import { describe, expect, test } from "vitest";
import { parseBridgeCliArgs } from "../src/index.js";

describe("parseBridgeCliArgs", () => {
    test("returns empty overrides when argv is empty", () => {
        expect(parseBridgeCliArgs([])).toEqual({});
    });

    test("parses supported CLI flags into BridgeConfig overrides", () => {
        const overrides = parseBridgeCliArgs([
            "--host",
            "localhost",
            "--port",
            "3500",
            "--ws-path",
            "/acp",
            "--command",
            "/home/ubuntu/.local/bin/agy",
            "--args",
            "acp --sandbox",
            "--cwd",
            "/home/ubuntu/acp-sandbox",
        ]);

        expect(overrides).toEqual({
            host: "localhost",
            port: 3500,
            wsPath: "/acp",
            command: "/home/ubuntu/.local/bin/agy",
            args: [
                "acp",
                "--sandbox",
            ],
            defaultCwd: "/home/ubuntu/acp-sandbox",
        });
    });

    test("throws on invalid --port value, missing flag value, or unknown flag", () => {
        expect(() => parseBridgeCliArgs([
            "--port",
            "abc",
        ])).toThrow(/port/i);

        expect(() => parseBridgeCliArgs([
            "--cwd",
        ])).toThrow(/value/i);

        expect(() => parseBridgeCliArgs([
            "--bogus",
        ])).toThrow(/unknown cli flag/i);

        expect(() => parseBridgeCliArgs([
            "--bogus",
            "val",
        ])).toThrow(/unknown cli flag/i);
    });
});
