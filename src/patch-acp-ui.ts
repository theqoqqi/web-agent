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
        `  if (typeof document !== "undefined") {`,
        `    var decodeUriSafe = function (v) {`,
        `      try { return decodeURIComponent(v); } catch (e) { return v; }`,
        `    };`,
        `    var getActiveCwd = function () {`,
        `      var input = document.querySelector(".cwd-input");`,
        `      if (input && typeof input.value === "string" && input.value.trim()) {`,
        `        return input.value.trim();`,
        `      }`,
        `      var cwdLabel = document.querySelector(".cwd-path");`,
        `      if (cwdLabel) {`,
        `        var title = cwdLabel.getAttribute("title");`,
        `        if (title && title !== "Current directory" && title.trim()) {`,
        `          return title.trim();`,
        `        }`,
        `      }`,
        `      return "";`,
        `    };`,
        `    var resolveWithCwd = function (p) {`,
        `      var clean = (p || "").trim();`,
        `      if (!clean) return "";`,
        `      if (clean.charAt(0) === "/" || /^[A-Za-z]:[\\\\/]/.test(clean)) return clean;`,
        `      var cwd = getActiveCwd();`,
        `      if (!cwd) return "";`,
        `      return cwd.replace(/\\/+$/, "") + "/" + clean.replace(/^\\.\\//, "");`,
        `    };`,
        `    var fileUriToViewerUrl = function (rawUri) {`,
        `      var trimmed = (rawUri || "").trim();`,
        `      if (!/^file:/i.test(trimmed)) return null;`,
        `      var hashIdx = trimmed.indexOf("#");`,
        `      var noHash = hashIdx === -1 ? trimmed : trimmed.slice(0, hashIdx);`,
        `      var hash = hashIdx === -1 ? "" : trimmed.slice(hashIdx);`,
        `      var after = noHash.slice(5);`,
        `      var targetPath = "";`,
        `      if (after.indexOf("///") === 0) {`,
        `        targetPath = decodeUriSafe(after.slice(2));`,
        `        if (/^\\/[A-Za-z]:\\//.test(targetPath)) targetPath = targetPath.slice(1);`,
        `      } else if (/^\\/\\/localhost\\//i.test(after)) {`,
        `        targetPath = decodeUriSafe(after.slice(11));`,
        `        if (/^\\/[A-Za-z]:\\//.test(targetPath)) targetPath = targetPath.slice(1);`,
        `      } else {`,
        `        var rel = after.indexOf("//") === 0 ? after.slice(2) : after;`,
        `        targetPath = resolveWithCwd(decodeUriSafe(rel));`,
        `      }`,
        `      if (!targetPath) return null;`,
        `      return "/files?path=" + encodeURIComponent(targetPath) + hash;`,
        `    };`,
        `    var toolLocationToViewerUrl = function (rawText) {`,
        `      var cleaned = (rawText || "").replace(/^\\s*\\uD83D\\uDCC1\\s*/, "").trim();`,
        `      if (!cleaned) return null;`,
        `      var hashIdx = cleaned.indexOf("#");`,
        `      var pathPart = hashIdx === -1 ? cleaned : cleaned.slice(0, hashIdx);`,
        `      var hash = hashIdx === -1 ? "" : cleaned.slice(hashIdx);`,
        `      if (!hash) {`,
        `        var lm = /^(.*):(\\d+(?:-\\d+)?)$/.exec(pathPart);`,
        `        if (lm && lm[1] && lm[2]) {`,
        `          pathPart = lm[1];`,
        `          hash = "#" + (lm[2].indexOf("-") !== -1 ? lm[2].split("-").map(function (n) { return "L" + n; }).join("-") : "L" + lm[2]);`,
        `        }`,
        `      }`,
        `      var resolved = resolveWithCwd(pathPart);`,
        `      if (!resolved) return null;`,
        `      return "/files?path=" + encodeURIComponent(resolved) + hash;`,
        `    };`,
        `    var isRewriting = false;`,
        `    var rewriteFileElements = function () {`,
        `      if (isRewriting) return;`,
        `      isRewriting = true;`,
        `      try {`,
        `        var links = document.querySelectorAll('a[href^="file://"]');`,
        `        for (var i = 0; i < links.length; i++) {`,
        `          var a = links[i];`,
        `          var url = fileUriToViewerUrl(a.getAttribute("href"));`,
        `          if (url) {`,
        `            a.setAttribute("href", url);`,
        `            a.setAttribute("target", "_blank");`,
        `            a.setAttribute("rel", "noopener");`,
        `            a.setAttribute("data-acp-file-linked", "1");`,
        `          }`,
        `        }`,
        `        var locs = document.querySelectorAll(".tool-locations > .location:not([data-acp-file-linked])");`,
        `        for (var j = 0; j < locs.length; j++) {`,
        `          var loc = locs[j];`,
        `          loc.setAttribute("data-acp-file-linked", "1");`,
        `          var rawText = (loc.textContent || "").trim();`,
        `          var locUrl = toolLocationToViewerUrl(rawText);`,
        `          if (locUrl) {`,
        `            var linkEl = document.createElement("a");`,
        `            linkEl.setAttribute("href", locUrl);`,
        `            linkEl.setAttribute("target", "_blank");`,
        `            linkEl.setAttribute("rel", "noopener");`,
        `            linkEl.setAttribute("style", "color:inherit;text-decoration:underline;");`,
        `            linkEl.textContent = rawText;`,
        `            loc.textContent = "";`,
        `            loc.appendChild(linkEl);`,
        `          }`,
        `        }`,
        `      } finally {`,
        `        isRewriting = false;`,
        `      }`,
        `    };`,
        `    document.addEventListener("click", function (ev) {`,
        `      var t = ev && ev.target;`,
        `      if (!t || typeof t.closest !== "function") return;`,
        `      var a = t.closest('a[href^="file://"]');`,
        `      if (!a) return;`,
        `      var url = fileUriToViewerUrl(a.getAttribute("href"));`,
        `      if (!url) return;`,
        `      if (typeof ev.preventDefault === "function") ev.preventDefault();`,
        `      a.setAttribute("href", url);`,
        `      a.setAttribute("target", "_blank");`,
        `      a.setAttribute("rel", "noopener");`,
        `      a.setAttribute("data-acp-file-linked", "1");`,
        `      if (typeof window !== "undefined" && typeof window.open === "function") {`,
        `        window.open(url, "_blank", "noopener");`,
        `      }`,
        `    }, true);`,
        `    var startDomObserver = function () {`,
        `      rewriteFileElements();`,
        `      if (typeof MutationObserver === "function") {`,
        `        var root = document.body || document.documentElement;`,
        `        if (root) {`,
        `          new MutationObserver(rewriteFileElements).observe(root, { childList: true, subtree: true });`,
        `        }`,
        `      }`,
        `    };`,
        `    if (document.readyState === "loading") {`,
        `      document.addEventListener("DOMContentLoaded", startDomObserver);`,
        `    } else {`,
        `      startDomObserver();`,
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
