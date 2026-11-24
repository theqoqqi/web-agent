import { statSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3001;
const DEFAULT_WS_PATH = "/ws";
const DEFAULT_COMMAND = "agy";
const DEFAULT_ARGS = [
    "acp",
];
const DEFAULT_SHUTDOWN_GRACE_MS = 3000;
const DEFAULT_MAX_LINE_BYTES = 16 * 1024 * 1024;
const DEFAULT_HEARTBEAT_PING_INTERVAL_MS = 30000;
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_VIEWER_SNIPPET_BYTES = 100 * 1024;
const DEFAULT_DETACHED_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_MAX_REPLAY_BUFFER_LINES = 2000;
const LOOPBACK_HOSTS = new Set([
    "127.0.0.1",
    "::1",
    "localhost",
]);

export interface BridgeConfig {
    host: string;
    port: number;
    wsPath: string;
    command: string;
    args: string[];
    defaultCwd: string;
    shutdownGraceMs: number;
    maxLineBytes: number;
    heartbeatPingIntervalMs: number;
    maxFileBytes: number;
    viewerSnippetBytes: number;
    detachedTimeoutMs: number;
    maxReplayBufferLines: number;
}

export interface ResolveBridgeConfigInput {
    env?: Record<string, string | undefined>;
    overrides?: Partial<BridgeConfig>;
}

export function resolveBridgeConfig(input: ResolveBridgeConfigInput = {}): BridgeConfig {
    const env = input.env ?? {};
    const overrides = input.overrides ?? {};

    const host = validateLoopbackHost(overrides.host ?? env.ACP_BRIDGE_HOST ?? DEFAULT_HOST);
    const port = resolvePort(overrides.port ?? env.ACP_BRIDGE_PORT ?? DEFAULT_PORT);
    const wsPath = validateWsPath(overrides.wsPath ?? env.ACP_BRIDGE_WS_PATH ?? DEFAULT_WS_PATH);
    const command = validateNonEmptyString(
        overrides.command ?? env.ACP_COMMAND ?? DEFAULT_COMMAND,
        "command",
    );
    const args = resolveArgs(overrides.args, env.ACP_ARGS);
    const defaultCwd = validateDirectory(overrides.defaultCwd ?? env.ACP_SANDBOX_DIR);
    const shutdownGraceMs = resolveInteger(
        overrides.shutdownGraceMs ?? env.ACP_SHUTDOWN_GRACE_MS ?? DEFAULT_SHUTDOWN_GRACE_MS,
        "shutdownGraceMs",
        0,
    );
    const maxLineBytes = resolveInteger(
        overrides.maxLineBytes ?? env.ACP_MAX_LINE_BYTES ?? DEFAULT_MAX_LINE_BYTES,
        "maxLineBytes",
        1,
    );
    const heartbeatPingIntervalMs = resolveInteger(
        overrides.heartbeatPingIntervalMs ??
            env.ACP_HEARTBEAT_MS ??
            DEFAULT_HEARTBEAT_PING_INTERVAL_MS,
        "heartbeatPingIntervalMs",
        0,
    );
    const maxFileBytes = resolveInteger(
        overrides.maxFileBytes ?? env.ACP_VIEWER_MAX_BYTES ?? DEFAULT_MAX_FILE_BYTES,
        "maxFileBytes",
        1,
    );
    const viewerSnippetBytes = resolveInteger(
        overrides.viewerSnippetBytes ?? env.ACP_VIEWER_SNIPPET_BYTES ?? DEFAULT_VIEWER_SNIPPET_BYTES,
        "viewerSnippetBytes",
        1,
    );
    const detachedTimeoutMs = resolveInteger(
        overrides.detachedTimeoutMs ?? env.ACP_DETACHED_TIMEOUT_MS ?? DEFAULT_DETACHED_TIMEOUT_MS,
        "detachedTimeoutMs",
        0,
    );
    const maxReplayBufferLines = resolveInteger(
        overrides.maxReplayBufferLines ??
            env.ACP_MAX_REPLAY_BUFFER_LINES ??
            DEFAULT_MAX_REPLAY_BUFFER_LINES,
        "maxReplayBufferLines",
        1,
    );

    return {
        host,
        port,
        wsPath,
        command,
        args,
        defaultCwd,
        shutdownGraceMs,
        maxLineBytes,
        heartbeatPingIntervalMs,
        maxFileBytes,
        viewerSnippetBytes,
        detachedTimeoutMs,
        maxReplayBufferLines,
    };
}

function validateLoopbackHost(rawHost: string): string {
    const host = rawHost.trim();
    if (!LOOPBACK_HOSTS.has(host)) {
        throw new Error(`Bridge host must be a loopback address, received "${rawHost}"`);
    }
    return host;
}

function resolvePort(rawPort: number | string): number {
    const port = parseStrictInteger(rawPort, "port");
    if (port < 1 || port > 65535) {
        throw new Error(`Bridge port must be between 1 and 65535, received ${rawPort}`);
    }
    return port;
}

function validateWsPath(rawPath: string): string {
    const wsPath = rawPath.trim();
    if (!wsPath.startsWith("/")) {
        throw new Error(`Bridge wsPath must start with "/", received "${rawPath}"`);
    }
    return wsPath;
}

function validateNonEmptyString(value: string, fieldName: string): string {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        throw new Error(`Bridge ${fieldName} must not be empty`);
    }
    return trimmed;
}

function resolveArgs(overrideArgs: string[] | undefined, envArgs: string | undefined): string[] {
    if (overrideArgs !== undefined) {
        return [
            ...overrideArgs,
        ];
    }
    if (envArgs !== undefined && envArgs.trim().length > 0) {
        return envArgs.trim().split(/\s+/);
    }
    return [
        ...DEFAULT_ARGS,
    ];
}

function validateDirectory(rawPath: string | undefined): string {
    if (!rawPath || rawPath.trim().length === 0) {
        throw new Error("Bridge defaultCwd (ACP_SANDBOX_DIR) is required");
    }

    const resolvedPath = resolve(rawPath);
    let stats: ReturnType<typeof statSync>;
    try {
        stats = statSync(resolvedPath);
    } catch {
        throw new Error(`Bridge defaultCwd directory does not exist: ${resolvedPath}`);
    }

    if (!stats.isDirectory()) {
        throw new Error(`Bridge defaultCwd is not a directory: ${resolvedPath}`);
    }

    return resolvedPath;
}

function resolveInteger(rawValue: number | string, fieldName: string, min: number): number {
    const parsed = parseStrictInteger(rawValue, fieldName);
    if (parsed < min) {
        throw new Error(`Bridge ${fieldName} must be >= ${min}, received ${rawValue}`);
    }
    return parsed;
}

function parseStrictInteger(rawValue: number | string, fieldName: string): number {
    if (typeof rawValue === "number") {
        if (!Number.isInteger(rawValue)) {
            throw new Error(`Bridge ${fieldName} must be an integer, received ${rawValue}`);
        }
        return rawValue;
    }

    const trimmed = rawValue.trim();
    if (!/^-?\d+$/.test(trimmed)) {
        throw new Error(`Bridge ${fieldName} must be an integer, received "${rawValue}"`);
    }
    return Number(trimmed);
}
