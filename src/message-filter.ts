const HEARTBEAT_METHOD = "$/ping";

type JsonObject = Record<string, unknown>;

export function normalizeClientFrame(raw: string): string | null {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        return null;
    }

    const parsed = parseJsonObject(trimmed);
    if (isHeartbeatNotification(parsed)) {
        return null;
    }

    return `${JSON.stringify(parsed)}\n`;
}

function parseJsonObject(text: string): JsonObject {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Invalid JSON-RPC payload: ${message}`);
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new Error("JSON-RPC payload must be a JSON object");
    }

    return parsed as JsonObject;
}

function isHeartbeatNotification(payload: JsonObject): boolean {
    const hasId = Object.prototype.hasOwnProperty.call(payload, "id") && payload.id !== undefined;
    return !hasId && payload.method === HEARTBEAT_METHOD;
}
