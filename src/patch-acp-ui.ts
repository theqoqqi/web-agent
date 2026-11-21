import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BOOTSTRAP_MARKER = "data-acp-web-bootstrap";
const DEFAULT_AGENT_NAME = "Antigravity";
const DEFAULT_WS_PATH = "/ws";
const AGENTS_STORAGE_KEY = "acp-ui:agents";

export interface AcpPatchOptions {
    agentName: string;
    wsPath: string;
}

export function patchAcpUiHtml(
    html: string,
    options: Partial<AcpPatchOptions> = {},
): string {
    if (html.includes(BOOTSTRAP_MARKER)) {
        return html;
    }

    const normalizedOptions = normalizePatchOptions(options);
    const injection = buildBootstrapScriptTag(normalizedOptions);
    const insertionIndex = findHeadInsertionIndex(html);

    return `${html.slice(0, insertionIndex)}${injection}\n${html.slice(insertionIndex)}`;
}

export function patchAcpUiFile(
    htmlPath: string,
    options: Partial<AcpPatchOptions> = {},
): boolean {
    const resolvedPath = resolve(htmlPath);
    const original = readFileSync(resolvedPath, "utf8");
    const patched = patchAcpUiHtml(original, options);
    if (patched === original) {
        return false;
    }
    writeFileSync(resolvedPath, patched, "utf8");
    return true;
}

function normalizePatchOptions(options: Partial<AcpPatchOptions>): AcpPatchOptions {
    const agentName = (options.agentName ?? DEFAULT_AGENT_NAME).trim();
    if (agentName.length === 0) {
        throw new Error("agentName must not be empty");
    }

    const wsPath = (options.wsPath ?? DEFAULT_WS_PATH).trim();
    if (!wsPath.startsWith("/")) {
        throw new Error(`wsPath must start with "/", received "${wsPath}"`);
    }

    return {
        agentName,
        wsPath,
    };
}

function findHeadInsertionIndex(html: string): number {
    const headOpenMatch = /<head\b[^>]*>/i.exec(html);
    const headCloseMatch = /<\/head>/i.exec(html);
    if (!headOpenMatch || !headCloseMatch || headCloseMatch.index <= headOpenMatch.index) {
        throw new Error("Target HTML does not contain a valid <head> section");
    }

    const headStart = headOpenMatch.index + headOpenMatch[0].length;
    const headClose = headCloseMatch.index;
    const headBody = html.slice(headStart, headClose);
    const firstScriptMatch = /<script\b/i.exec(headBody);
    if (firstScriptMatch) {
        return headStart + firstScriptMatch.index;
    }

    return headClose;
}

function buildBootstrapScriptTag(options: AcpPatchOptions): string {
    const safeAgentName = serializeForInlineScript(options.agentName);
    const safeWsPath = serializeForInlineScript(options.wsPath);
    const safeStorageKey = serializeForInlineScript(AGENTS_STORAGE_KEY);

    const scriptLines = [
        `(function () {`,
        `  var c = typeof crypto !== "undefined" ? crypto : null;`,
        `  if (c && typeof c.randomUUID !== "function" && typeof c.getRandomValues === "function") {`,
        `    var fallbackRandomUUID = function () {`,
        `      var b = new Uint8Array(16);`,
        `      c.getRandomValues(b);`,
        `      b[6] = (b[6] & 0x0f) | 0x40;`,
        `      b[8] = (b[8] & 0x3f) | 0x80;`,
        `      var hex = [];`,
        `      for (var i = 0; i < b.length; i++) {`,
        `        hex.push((b[i] + 0x100).toString(16).slice(1));`,
        `      }`,
        `      return (`,
        `        hex.slice(0, 4).join("") + "-" +`,
        `        hex.slice(4, 6).join("") + "-" +`,
        `        hex.slice(6, 8).join("") + "-" +`,
        `        hex.slice(8, 10).join("") + "-" +`,
        `        hex.slice(10, 16).join("")`,
        `      );`,
        `    };`,
        `    try {`,
        `      Object.defineProperty(c, "randomUUID", {`,
        `        value: fallbackRandomUUID,`,
        `        configurable: true,`,
        `        writable: true`,
        `      });`,
        `    } catch (e) {`,
        `      c.randomUUID = fallbackRandomUUID;`,
        `    }`,
        `  }`,
        `  if (typeof localStorage !== "undefined" && typeof location !== "undefined") {`,
        `    var key = ${safeStorageKey};`,
        `    if (localStorage.getItem(key) === null) {`,
        `      var proto = location.protocol === "https:" ? "wss:" : "ws:";`,
        `      var wsUrl = proto + "//" + location.host + ${safeWsPath};`,
        `      var payload = { agents: {} };`,
        `      payload.agents[${safeAgentName}] = { transport: "websocket", url: wsUrl };`,
        `      localStorage.setItem(key, JSON.stringify(payload));`,
        `    }`,
        `  }`,
        `})();`,
    ];

    return `<script ${BOOTSTRAP_MARKER}>\n${scriptLines.join("\n")}\n</script>`;
}

function serializeForInlineScript(value: string): string {
    return JSON.stringify(value).replace(/</g, "\\u003c");
}

function runCli(): void {
    const args = process.argv.slice(2);
    let targetPath: string | undefined;
    let agentName: string | undefined;
    let wsPath: string | undefined;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--agent" && args[i + 1]) {
            agentName = args[++i];
        } else if (arg === "--ws-path" && args[i + 1]) {
            wsPath = args[++i];
        } else if (arg && !arg.startsWith("-")) {
            targetPath = arg;
        }
    }

    if (!targetPath) {
        throw new Error("Usage: patch-acp-ui <path-to-index.html> [--agent Name] [--ws-path /ws]");
    }

    const updated = patchAcpUiFile(targetPath, {
        agentName,
        wsPath,
    });
    console.log(
        updated
            ? `[patch-acp-ui] Patched ${resolve(targetPath)}`
            : `[patch-acp-ui] Already patched: ${resolve(targetPath)}`,
    );
}

function isDirectCliExecution(): boolean {
    const entry = process.argv[1];
    if (!entry) {
        return false;
    }
    return resolve(entry) === resolve(fileURLToPath(import.meta.url));
}

if (isDirectCliExecution()) {
    runCli();
}
