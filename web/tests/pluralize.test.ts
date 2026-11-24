import { describe, expect, test } from "vitest";
import { pluralize } from "../src/lib/pluralize";

describe("pluralize", () => {
    test("склоняет числительные с учётом окончаний и исключений 11-19", () => {
        const forms: [string, string, string] = ["действие", "действия", "действий"];

        expect(pluralize(1, forms)).toBe("1 действие");
        expect(pluralize(2, forms)).toBe("2 действия");
        expect(pluralize(4, forms)).toBe("4 действия");
        expect(pluralize(5, forms)).toBe("5 действий");
        expect(pluralize(11, forms)).toBe("11 действий");
        expect(pluralize(14, forms)).toBe("14 действий");
        expect(pluralize(21, forms)).toBe("21 действие");
        expect(pluralize(23, forms)).toBe("23 действия");
        expect(pluralize(25, forms)).toBe("25 действий");
    });
});
