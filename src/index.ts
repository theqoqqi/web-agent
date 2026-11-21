import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAcpWsBridge } from "./bridge.js";
import { resolveBridgeConfig, type BridgeConfig } from "./config.js";

const SUPPORTED_FLAGS = new Set([
    "--host",
    "--port",
    "--ws-path",
    "--command",
    "--args",
    "--cwd",
]);

export function parseBridgeCliArgs(argv: string[]): Partial<BridgeConfig> {
    const overrides: Partial<BridgeConfig> = {};

    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (!flag) {
            continue;
        }

        if (!SUPPORTED_FLAGS.has(flag)) {
            throw new Error(`Unknown CLI flag "${flag}"`);
        }

        const value = argv[i + 1];
        if (value === undefined || value.startsWith("--")) {
            throw new Error(`Missing value for CLI flag "${flag}"`);
        }

        i++;

        applyCliFlag(overrides, flag, value);
    }

    return overrides;
}

export async function runBridgeCli(
    argv: string[] = process.argv.slice(2),
    env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
    const config = resolveBridgeConfig({
        env,
        overrides: parseBridgeCliArgs(argv),
    });

    const bridge = await createAcpWsBridge(config, {
        env,
    });

    console.log(
        `[acp-bridge] Listening on ws://${bridge.host}:${bridge.port}${config.wsPath} (cwd: ${config.defaultCwd})`,
    );

    let closing = false;
    const shutdown = async (signal: string): Promise<void> => {
        if (closing) {
            return;
        }
        closing = true;
        console.log(`[acp-bridge] Received ${signal}, shutting down...`);
        await bridge.close();
        process.exit(0);
    };

    process.once("SIGINT", () => {
        void shutdown("SIGINT");
    });
    process.once("SIGTERM", () => {
        void shutdown("SIGTERM");
    });
}

function applyCliFlag(
    overrides: Partial<BridgeConfig>,
    flag: string,
    value: string,
): void {
    switch (flag) {
        case "--host":
            overrides.host = value;
            return;
        case "--port":
            overrides.port = parsePortFlag(value);
            return;
        case "--ws-path":
            overrides.wsPath = value;
            return;
        case "--command":
            overrides.command = value;
            return;
        case "--args":
            overrides.args = value.trim().split(/\s+/).filter(Boolean);
            return;
        case "--cwd":
            overrides.defaultCwd = value;
            return;
        default:
            throw new Error(`Unknown CLI flag "${flag}"`);
    }
}

function parsePortFlag(rawPort: string): number {
    if (!/^\d+$/.test(rawPort.trim())) {
        throw new Error(`Invalid --port value "${rawPort}"`);
    }
    return Number(rawPort.trim());
}

function isDirectCliExecution(): boolean {
    const entry = process.argv[1];
    if (!entry) {
        return false;
    }
    return resolve(entry) === resolve(fileURLToPath(import.meta.url));
}

if (isDirectCliExecution()) {
    void runBridgeCli().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[acp-bridge] Fatal error: ${message}`);
        process.exit(1);
    });
}
