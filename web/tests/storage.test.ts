import { beforeEach, describe, expect, test } from "vitest";
import {
    DEFAULT_CWD,
    getLastActiveSessionId,
    getStoredCwd,
    getStoredSessions,
    getStoredTheme,
    removeStoredSession,
    renameStoredSession,
    setLastActiveSessionId,
    setStoredCwd,
    setStoredTheme,
    upsertStoredSession,
} from "../src/lib/storage";

describe("storage", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    test("возвращает /srv как cwd по умолчанию и триммит сохранённый путь", () => {
        expect(getStoredCwd()).toBe("/srv");
        expect(DEFAULT_CWD).toBe("/srv");

        setStoredCwd("  /srv/app  ");
        expect(getStoredCwd()).toBe("/srv/app");

        setStoredCwd("   ");
        expect(getStoredCwd()).toBe("/srv");
    });

    test("сохраняет и читает только поддерживаемые значения темы", () => {
        expect(getStoredTheme()).toBeNull();

        setStoredTheme("dark");
        expect(getStoredTheme()).toBe("dark");

        window.localStorage.setItem("web-agent:theme", "sepia");
        expect(getStoredTheme()).toBeNull();
    });

    test("безопасно сбрасывает битый JSON списка сессий в пустой массив", () => {
        window.localStorage.setItem("web-agent:sessions", "{broken-json");

        expect(getStoredSessions()).toEqual([]);
    });

    test("отбрасывает некорректные записи при чтении сессий", () => {
        window.localStorage.setItem(
            "web-agent:sessions",
            JSON.stringify([
                {
                    sessionId: "s-1",
                    cwd: "/srv",
                    title: "Первая",
                    updatedAt: 100,
                },
                {
                    sessionId: "",
                    cwd: "/srv",
                    title: "Битая",
                    updatedAt: 200,
                },
                null,
            ]),
        );

        expect(getStoredSessions()).toEqual([
            {
                sessionId: "s-1",
                cwd: "/srv",
                title: "Первая",
                updatedAt: 100,
            },
        ]);
    });

    test("обновляет существующую сессию без дубликатов и удаляет по sessionId", () => {
        upsertStoredSession({
            sessionId: "s-1",
            cwd: "/srv",
            title: "Старая",
            updatedAt: 100,
        });
        upsertStoredSession({
            sessionId: "s-2",
            cwd: "/srv/web",
            title: "Вторая",
            updatedAt: 200,
        });
        const afterUpdate = upsertStoredSession({
            sessionId: "s-1",
            cwd: "/srv",
            title: "Обновлённая",
            updatedAt: 300,
        });

        expect(afterUpdate).toEqual([
            {
                sessionId: "s-1",
                cwd: "/srv",
                title: "Обновлённая",
                updatedAt: 300,
            },
            {
                sessionId: "s-2",
                cwd: "/srv/web",
                title: "Вторая",
                updatedAt: 200,
            },
        ]);

        const afterRemove = removeStoredSession("s-1");
        expect(afterRemove).toEqual([
            {
                sessionId: "s-2",
                cwd: "/srv/web",
                title: "Вторая",
                updatedAt: 200,
            },
        ]);
    });

    test("сохраняет, читает и сбрасывает идентификатор последней активной сессии", () => {
        expect(getLastActiveSessionId()).toBeNull();

        setLastActiveSessionId("  sess-123  ");
        expect(getLastActiveSessionId()).toBe("sess-123");

        setLastActiveSessionId("");
        expect(getLastActiveSessionId()).toBeNull();

        setLastActiveSessionId("sess-456");
        expect(getLastActiveSessionId()).toBe("sess-456");

        setLastActiveSessionId(null);
        expect(getLastActiveSessionId()).toBeNull();
    });

    test("автоматически подтягивает и мигрирует сессии из acp-ui:sessions.json", () => {
        window.localStorage.setItem(
            "acp-ui:sessions.json",
            JSON.stringify({
                sessions: [
                    {
                        sessionId: "legacy-1",
                        title: "Сессия из старого UI",
                        cwd: "/srv/legacy",
                        lastUpdated: 1700000000000,
                    },
                    {
                        sessionId: "legacy-2",
                        title: "Вторая старая",
                        lastUpdated: 1700000010000,
                    },
                ],
            }),
        );

        const loaded = getStoredSessions();
        expect(loaded).toEqual([
            {
                sessionId: "legacy-2",
                title: "Вторая старая",
                cwd: "/srv",
                updatedAt: 1700000010000,
            },
            {
                sessionId: "legacy-1",
                title: "Сессия из старого UI",
                cwd: "/srv/legacy",
                updatedAt: 1700000000000,
            },
        ]);

        const persistedInNewKey = JSON.parse(
            window.localStorage.getItem("web-agent:sessions") ?? "[]",
        );
        expect(persistedInNewKey).toEqual(loaded);
    });

    test("подтягивает lastCwd из acp-ui:preferences.json если свой ключ пуст", () => {
        window.localStorage.setItem(
            "acp-ui:preferences.json",
            JSON.stringify({ lastCwd: "/srv/from-acp-ui" }),
        );

        expect(getStoredCwd()).toBe("/srv/from-acp-ui");

        setStoredCwd("/srv/new-cwd");
        expect(getStoredCwd()).toBe("/srv/new-cwd");
    });

    test("переименовывает существующую сессию и игнорирует отсутствующую", () => {
        upsertStoredSession({
            sessionId: "s-1",
            cwd: "/srv",
            title: "Старое имя",
            updatedAt: 100,
        });

        const renamed = renameStoredSession("s-1", "  Новое имя  ");
        expect(renamed[0]?.title).toBe("Новое имя");

        const fallback = renameStoredSession("s-1", "   ");
        expect(fallback[0]?.title).toBe("s-1");

        const unhit = renameStoredSession("non-existent", "Test");
        expect(unhit).toHaveLength(1);
    });
});
