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
const SESSIONS_STORAGE_KEY = "web-agent:sessions";
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

    return trimmed && trimmed.length > 0 ? trimmed : DEFAULT_CWD;
}

export function setStoredCwd(cwd: string): void {
    const trimmed = cwd.trim();
    writeStorageItem(
        LAST_CWD_STORAGE_KEY,
        trimmed.length > 0 ? trimmed : DEFAULT_CWD,
    );
}

export function getStoredSessions(): StoredSession[] {
    const raw = readStorageItem(SESSIONS_STORAGE_KEY);

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
