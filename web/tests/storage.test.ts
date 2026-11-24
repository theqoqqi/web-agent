import { beforeEach, describe, expect, test } from "vitest";
import {
    DEFAULT_CWD,
    getStoredCwd,
    getStoredSessions,
    getStoredTheme,
    removeStoredSession,
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
});
