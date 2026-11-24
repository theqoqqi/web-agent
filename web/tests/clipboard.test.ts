import { afterEach, describe, expect, test, vi } from "vitest";
import { copyText } from "../src/lib/clipboard";

describe("copyText", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        document.body.innerHTML = "";
    });

    test("копирует через navigator.clipboard.writeText и возвращает true", async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", {
            value: {
                writeText,
            },
            configurable: true,
        });

        const copied = await copyText("hello acp");

        expect(copied).toBe(true);
        expect(writeText).toHaveBeenCalledWith("hello acp");
    });

    test("использует document.execCommand('copy') при отсутствии navigator.clipboard и удаляет временную textarea", async () => {
        Object.defineProperty(navigator, "clipboard", {
            value: undefined,
            configurable: true,
        });

        let capturedValue = "";
        const execCommandSpy = vi.fn(() => {
            const textarea = document.body.querySelector("textarea");
            capturedValue = textarea?.value ?? "";
            return true;
        });
        Object.defineProperty(document, "execCommand", {
            value: execCommandSpy,
            configurable: true,
        });

        const copied = await copyText("http fallback");

        expect(copied).toBe(true);
        expect(execCommandSpy).toHaveBeenCalledWith("copy");
        expect(capturedValue).toBe("http fallback");
        expect(document.body.querySelector("textarea")).toBeNull();
    });

    test("переключается на execCommand, если navigator.clipboard.writeText отклоняется", async () => {
        Object.defineProperty(navigator, "clipboard", {
            value: {
                writeText: vi.fn().mockRejectedValue(new Error("NotAllowedError")),
            },
            configurable: true,
        });
        Object.defineProperty(document, "execCommand", {
            value: vi.fn(() => true),
            configurable: true,
        });

        const copied = await copyText("retry copy");

        expect(copied).toBe(true);
        expect(document.body.querySelector("textarea")).toBeNull();
    });

    test("возвращает false, если оба механизма копирования не сработали", async () => {
        Object.defineProperty(navigator, "clipboard", {
            value: undefined,
            configurable: true,
        });
        Object.defineProperty(document, "execCommand", {
            value: vi.fn(() => false),
            configurable: true,
        });

        const copied = await copyText("cannot copy");

        expect(copied).toBe(false);
        expect(document.body.querySelector("textarea")).toBeNull();
    });
});
