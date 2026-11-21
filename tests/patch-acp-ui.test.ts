import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { afterEach, describe, expect, test } from "vitest";
import { patchAcpUiFile, patchAcpUiHtml } from "../src/patch-acp-ui.js";

const SAMPLE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>ACP UI</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`;

function extractInjectedScript(patchedHtml: string): string {
    const match = /<script\b[^>]*data-acp-web-bootstrap[^>]*>([\s\S]*?)<\/script>/i.exec(patchedHtml);
    if (!match || !match[1]) {
        throw new Error("Injected bootstrap script not found");
    }
    return match[1];
}

function createMemoryStorage(initial: Record<string, string> = {}): Storage {
    const map = new Map<string, string>(Object.entries(initial));
    return {
        get length(): number {
            return map.size;
        },
        clear(): void {
            map.clear();
        },
        getItem(key: string): string | null {
            return map.get(key) ?? null;
        },
        key(index: number): string | null {
            return [
                ...map.keys(),
            ][index] ?? null;
        },
        removeItem(key: string): void {
            map.delete(key);
        },
        setItem(key: string, value: string): void {
            map.set(key, String(value));
        },
    };
}

describe("patchAcpUiHtml", () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        while (tempDirs.length > 0) {
            const dir = tempDirs.pop();
            if (dir) {
                rmSync(dir, {
                    recursive: true,
                    force: true,
                });
            }
        }
    });

    test("injects bootstrap script inside <head> before first <script> and throws when <head> is missing", () => {
        const patched = patchAcpUiHtml(SAMPLE_HTML);
        const headEndIndex = patched.toLowerCase().indexOf("</head>");
        const bootstrapIndex = patched.indexOf("data-acp-web-bootstrap");
        const moduleScriptIndex = patched.indexOf('src="/src/main.ts"');

        expect(bootstrapIndex).toBeGreaterThan(-1);
        expect(bootstrapIndex).toBeLessThan(headEndIndex);
        expect(bootstrapIndex).toBeLessThan(moduleScriptIndex);

        expect(() => patchAcpUiHtml("<html><body><div>No head</div></body></html>")).toThrow(
            /<head>/i,
        );
    });

    test("installs crypto.randomUUID polyfill in insecure context without overwriting native implementation", () => {
        const patched = patchAcpUiHtml(SAMPLE_HTML);
        const scriptCode = extractInjectedScript(patched);

        const insecureCrypto: {
            getRandomValues: typeof crypto.getRandomValues;
            randomUUID?: () => string;
        } = {
            getRandomValues: crypto.getRandomValues.bind(crypto),
        };

        const storage = createMemoryStorage();
        vm.runInNewContext(scriptCode, {
            crypto: insecureCrypto,
            localStorage: storage,
            location: {
                protocol: "http:",
                host: "172.29.172.1:7682",
            },
        });

        expect(typeof insecureCrypto.randomUUID).toBe("function");
        const uuid = insecureCrypto.randomUUID!();
        expect(uuid).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );

        const nativeSentinel = (): string => "00000000-0000-4000-8000-000000000000";
        const secureCrypto = {
            getRandomValues: insecureCrypto.getRandomValues,
            randomUUID: nativeSentinel,
        };
        vm.runInNewContext(scriptCode, {
            crypto: secureCrypto,
            localStorage: createMemoryStorage(),
            location: {
                protocol: "https:",
                host: "example.com",
            },
        });

        expect(secureCrypto.randomUUID).toBe(nativeSentinel);
    });

    test("seeds localStorage['acp-ui:agents'] with dynamic WebSocket URL only when missing", () => {
        const patched = patchAcpUiHtml(SAMPLE_HTML, {
            agentName: "Antigravity",
            wsPath: "/ws",
        });
        const scriptCode = extractInjectedScript(patched);

        const freshStorage = createMemoryStorage();
        vm.runInNewContext(scriptCode, {
            crypto: {
                getRandomValues: crypto.getRandomValues.bind(crypto),
            },
            localStorage: freshStorage,
            location: {
                protocol: "http:",
                host: "172.29.172.1:7682",
            },
        });

        expect(JSON.parse(freshStorage.getItem("acp-ui:agents") ?? "{}")).toEqual({
            agents: {
                Antigravity: {
                    transport: "websocket",
                    url: "ws://172.29.172.1:7682/ws",
                },
            },
        });

        const existingValue = JSON.stringify({
            agents: {
                Custom: {
                    transport: "websocket",
                    url: "ws://127.0.0.1:9000/custom",
                },
            },
        });
        const populatedStorage = createMemoryStorage({
            "acp-ui:agents": existingValue,
        });

        vm.runInNewContext(scriptCode, {
            crypto: {
                getRandomValues: crypto.getRandomValues.bind(crypto),
            },
            localStorage: populatedStorage,
            location: {
                protocol: "https:",
                host: "172.29.172.1:7682",
            },
        });

        expect(populatedStorage.getItem("acp-ui:agents")).toBe(existingValue);
    });

    test("is idempotent across repeated invocations on HTML and files", () => {
        const firstPass = patchAcpUiHtml(SAMPLE_HTML);
        const secondPass = patchAcpUiHtml(firstPass);
        expect(secondPass).toBe(firstPass);

        const occurrences = secondPass.match(/data-acp-web-bootstrap/g) ?? [];
        expect(occurrences).toHaveLength(1);

        const dir = mkdtempSync(join(tmpdir(), "acp-patch-test-"));
        tempDirs.push(dir);
        const filePath = join(dir, "index.html");
        writeFileSync(filePath, SAMPLE_HTML, "utf8");

        expect(patchAcpUiFile(filePath)).toBe(true);
        const writtenOnce = readFileSync(filePath, "utf8");
        expect(writtenOnce).toBe(firstPass);
        expect(patchAcpUiFile(filePath)).toBe(false);
    });
});
