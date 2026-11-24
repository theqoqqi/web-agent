import { afterEach, describe, expect, test, vi } from "vitest";
import { generateUuid } from "../src/lib/uuid";

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe("generateUuid", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    test("использует native crypto.randomUUID, если он доступен", () => {
        const expected = "11111111-2222-4333-8444-555555555555";
        const randomUuidSpy = vi.fn(() => expected);

        vi.stubGlobal("crypto", {
            randomUUID: randomUuidSpy,
            getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
        });

        expect(generateUuid()).toBe(expected);
        expect(randomUuidSpy).toHaveBeenCalledTimes(1);
    });

    test("генерирует разные UUID v4 через getRandomValues, когда crypto.randomUUID отсутствует", () => {
        vi.stubGlobal("crypto", {
            getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
        });

        const first = generateUuid();
        const second = generateUuid();

        expect(first).toMatch(UUID_V4_PATTERN);
        expect(second).toMatch(UUID_V4_PATTERN);
        expect(first).not.toBe(second);
    });

    test("возвращает валидный UUID v4 даже при полном отсутствии Web Crypto", () => {
        vi.stubGlobal("crypto", undefined);

        const value = generateUuid();

        expect(value).toMatch(UUID_V4_PATTERN);
    });
});
