export type ThemeMode = "dark" | "light";

export interface StoredSession {
    sessionId: string;
    cwd: string;
    title: string;
    updatedAt: number;
}

export const DEFAULT_CWD = "/srv";

const THEME_STORAGE_KEY = "web-agent:theme";
const LAST_CWD_STORAGE_KEY = "web-agent:last-cwd";
const LAST_SESSION_ID_STORAGE_KEY = "web-agent:last-session-id";
const SESSIONS_STORAGE_KEY = "web-agent:sessions";
const LEGACY_PREFERENCES_KEY = "acp-ui:preferences.json";
const LEGACY_ACP_UI_SESSIONS_KEYS = ["acp-ui:sessions.json", "acp-ui:sessions"] as const;
const MAX_STORED_SESSIONS = 50;

export function getStoredTheme(): ThemeMode | null {
    const raw = readStorageItem(THEME_STORAGE_KEY);

    if (raw === "dark" || raw === "light") {
        return raw;
    }

    return null;
}

export function setStoredTheme(theme: ThemeMode): void {
    writeStorageItem(THEME_STORAGE_KEY, theme);
}

export function getStoredCwd(): string {
    const raw = readStorageItem(LAST_CWD_STORAGE_KEY);
    const trimmed = raw?.trim();

    if (trimmed && trimmed.length > 0) {
        return trimmed;
    }

    const legacyRaw = readStorageItem(LEGACY_PREFERENCES_KEY);
    if (legacyRaw) {
        try {
            const parsed = JSON.parse(legacyRaw) as { lastCwd?: unknown };
            if (typeof parsed.lastCwd === "string" && parsed.lastCwd.trim().length > 0) {
                return parsed.lastCwd.trim();
            }
        } catch {
            // ignore malformed JSON
        }
    }

    return DEFAULT_CWD;
}

export function setStoredCwd(cwd: string): void {
    const trimmed = cwd.trim();
    writeStorageItem(
        LAST_CWD_STORAGE_KEY,
        trimmed.length > 0 ? trimmed : DEFAULT_CWD,
    );
}

export function getLastActiveSessionId(): string | null {
    const raw = readStorageItem(LAST_SESSION_ID_STORAGE_KEY);
    const trimmed = raw?.trim();

    return trimmed && trimmed.length > 0 ? trimmed : null;
}

export function setLastActiveSessionId(sessionId: string | null): void {
    if (!sessionId) {
        try {
            window.localStorage.removeItem(LAST_SESSION_ID_STORAGE_KEY);
        } catch {
            return;
        }
        return;
    }

    const trimmed = sessionId.trim();
    if (trimmed.length === 0) {
        try {
            window.localStorage.removeItem(LAST_SESSION_ID_STORAGE_KEY);
        } catch {
            return;
        }
        return;
    }

    writeStorageItem(LAST_SESSION_ID_STORAGE_KEY, trimmed);
}

export function getStoredSessions(): StoredSession[] {
    const raw = readStorageItem(SESSIONS_STORAGE_KEY);
    const currentSessions = parseStoredSessionsJson(raw);
    const existingIds = new Set(currentSessions.map((item) => item.sessionId));
    const legacySessions: StoredSession[] = [];

    for (const legacyKey of LEGACY_ACP_UI_SESSIONS_KEYS) {
        const rawLegacy = readStorageItem(legacyKey);
        if (!rawLegacy) {
            continue;
        }

        const parsed = parseLegacySessionsJson(rawLegacy);
        for (const session of parsed) {
            if (!existingIds.has(session.sessionId)) {
                legacySessions.push(session);
                existingIds.add(session.sessionId);
            }
        }
    }

    if (legacySessions.length > 0) {
        const merged = [...currentSessions, ...legacySessions]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .slice(0, MAX_STORED_SESSIONS);

        writeStorageItem(SESSIONS_STORAGE_KEY, JSON.stringify(merged));
        return merged;
    }

    return currentSessions;
}

export function upsertStoredSession(session: StoredSession): StoredSession[] {
    const existing = getStoredSessions().filter(
        (item) => item.sessionId !== session.sessionId,
    );
    const next = [session, ...existing].slice(0, MAX_STORED_SESSIONS);

    writeStorageItem(SESSIONS_STORAGE_KEY, JSON.stringify(next));
    return next;
}

export function removeStoredSession(sessionId: string): StoredSession[] {
    const next = getStoredSessions().filter(
        (item) => item.sessionId !== sessionId,
    );

    writeStorageItem(SESSIONS_STORAGE_KEY, JSON.stringify(next));
    return next;
}

export function renameStoredSession(sessionId: string, newTitle: string): StoredSession[] {
    const trimmedTitle = newTitle.trim();
    const sessions = getStoredSessions();
    const target = sessions.find((item) => item.sessionId === sessionId);

    if (!target) {
        return sessions;
    }

    const updatedTitle = trimmedTitle.length > 0 ? trimmedTitle : sessionId;
    const next = sessions.map((item) =>
        item.sessionId === sessionId
            ? { ...item, title: updatedTitle, updatedAt: Date.now() }
            : item,
    );

    writeStorageItem(SESSIONS_STORAGE_KEY, JSON.stringify(next));
    return next;
}

function isStoredSession(value: unknown): value is StoredSession {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    const record = value as Record<string, unknown>;

    return (
        typeof record.sessionId === "string" &&
        record.sessionId.trim().length > 0 &&
        typeof record.cwd === "string" &&
        record.cwd.trim().length > 0 &&
        typeof record.title === "string" &&
        typeof record.updatedAt === "number" &&
        Number.isFinite(record.updatedAt)
    );
}

function parseStoredSessionsJson(raw: string | null): StoredSession[] {
    if (!raw) {
        return [];
    }

    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed.filter(isStoredSession);
    } catch {
        return [];
    }
}

function parseLegacySessionsJson(raw: string): StoredSession[] {
    try {
        const parsed: unknown = JSON.parse(raw);
        let list: unknown[] = [];

        if (Array.isArray(parsed)) {
            list = parsed;
        } else if (
            typeof parsed === "object" &&
            parsed !== null &&
            "sessions" in parsed &&
            Array.isArray((parsed as { sessions?: unknown }).sessions)
        ) {
            list = (parsed as { sessions: unknown[] }).sessions;
        }

        const results: StoredSession[] = [];

        for (const item of list) {
            if (typeof item !== "object" || item === null) {
                continue;
            }

            const rec = item as Record<string, unknown>;
            const rawId = typeof rec.sessionId === "string" && rec.sessionId.trim().length > 0
                ? rec.sessionId.trim()
                : typeof rec.id === "string" && rec.id.trim().length > 0
                ? rec.id.trim()
                : null;

            if (!rawId) {
                continue;
            }

            const cwd = typeof rec.cwd === "string" && rec.cwd.trim().length > 0
                ? rec.cwd.trim()
                : DEFAULT_CWD;

            const title = typeof rec.title === "string" && rec.title.trim().length > 0
                ? rec.title.trim()
                : rawId;

            const updatedAt = typeof rec.lastUpdated === "number" && Number.isFinite(rec.lastUpdated)
                ? rec.lastUpdated
                : typeof rec.updatedAt === "number" && Number.isFinite(rec.updatedAt)
                ? rec.updatedAt
                : Date.now();

            results.push({
                sessionId: rawId,
                cwd,
                title,
                updatedAt,
            });
        }

        return results;
    } catch {
        return [];
    }
}

function readStorageItem(key: string): string | null {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function writeStorageItem(key: string, value: string): void {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        return;
    }
}
