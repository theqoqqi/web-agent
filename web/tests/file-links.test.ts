import { describe, expect, test } from "vitest";
import {
    convertFileUriToViewerUrl,
    resolveLocationToViewerUrl,
    sanitizeHref,
} from "../src/lib/file-links";

describe("file-links", () => {
    test("конвертирует file:/// URI в /files?path=... с сохранением якоря строки", () => {
        expect(convertFileUriToViewerUrl("file:///srv/src/app.ts#L15")).toBe(
            "/files?path=%2Fsrv%2Fsrc%2Fapp.ts#L15",
        );
    });

    test("убирает ведущий слэш у Windows drive URI и поддерживает localhost", () => {
        expect(convertFileUriToViewerUrl("file:///C:/work/test.ts#L3")).toBe(
            "/files?path=C%3A%2Fwork%2Ftest.ts#L3",
        );
        expect(convertFileUriToViewerUrl("file://localhost/srv/readme.md")).toBe(
            "/files?path=%2Fsrv%2Freadme.md",
        );
    });

    test("корректно перекодирует пробелы и # в имени файла из URI", () => {
        expect(convertFileUriToViewerUrl("file:///srv/my%20dir/file%231.txt")).toBe(
            "/files?path=%2Fsrv%2Fmy%20dir%2Ffile%231.txt",
        );
    });

    test("разрешает локации toolCall с абсолютным и относительным путём и номером строки", () => {
        expect(resolveLocationToViewerUrl("/srv/src/index.ts", 42)).toBe(
            "/files?path=%2Fsrv%2Fsrc%2Findex.ts#L42",
        );
        expect(resolveLocationToViewerUrl("src/app.ts", 7, "/srv/proj/")).toBe(
            "/files?path=%2Fsrv%2Fproj%2Fsrc%2Fapp.ts#L7",
        );
        expect(resolveLocationToViewerUrl("/srv/a.ts:10-20")).toBe(
            "/files?path=%2Fsrv%2Fa.ts#L10-L20",
        );
        expect(resolveLocationToViewerUrl("relative.ts", undefined, undefined)).toBeNull();
    });

    test("блокирует опасные схемы в ссылках и пропускает безопасные http/https/mailto и /files", () => {
        expect(sanitizeHref("javascript:alert(1)")).toBe("#");
        expect(sanitizeHref("  JaVaScRiPt:void(0)  ")).toBe("#");
        expect(sanitizeHref("data:text/html,<script>alert(1)</script>")).toBe("#");
        expect(sanitizeHref("vbscript:msgbox(1)")).toBe("#");

        expect(sanitizeHref("https://example.com/docs?q=1")).toBe("https://example.com/docs?q=1");
        expect(sanitizeHref("mailto:user@example.com")).toBe("mailto:user@example.com");
        expect(sanitizeHref("file:///srv/a.ts")).toBe("/files?path=%2Fsrv%2Fa.ts");
    });
});
