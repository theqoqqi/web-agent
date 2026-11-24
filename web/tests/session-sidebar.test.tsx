import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { SessionSidebar } from "../src/components/SessionSidebar";
import type { StoredSession } from "../src/lib/storage";

function createMockSessions(): StoredSession[] {
    return [
        {
            sessionId: "s-1",
            title: "Первая сессия",
            cwd: "/srv",
            updatedAt: Date.now(),
        },
    ];
}

describe("SessionSidebar", () => {
    test("отображает кнопку переключения темы внизу бокового меню и вызывает onToggleTheme при клике", () => {
        const onToggleTheme = vi.fn();
        const { rerender } = render(
            <SessionSidebar
                sessions={createMockSessions()}
                activeSessionId="s-1"
                cwd="/srv"
                canLoadSession={true}
                isConnected={true}
                theme="dark"
                onToggleTheme={onToggleTheme}
                onChangeCwd={vi.fn()}
                onNewSession={vi.fn()}
                onSelectSession={vi.fn()}
                onDeleteSession={vi.fn()}
                onOpenSessionById={vi.fn().mockResolvedValue(true)}
                onRenameSession={vi.fn()}
            />,
        );

        const toggleBtn = screen.getByRole("button", {
            name: "Переключить тему",
        });
        expect(toggleBtn).toBeInTheDocument();
        expect(toggleBtn).toHaveTextContent("Светлая тема");
        expect(toggleBtn).toHaveAttribute("title", "Светлая тема");

        fireEvent.click(toggleBtn);
        expect(onToggleTheme).toHaveBeenCalledTimes(1);

        rerender(
            <SessionSidebar
                sessions={createMockSessions()}
                activeSessionId="s-1"
                cwd="/srv"
                canLoadSession={true}
                isConnected={true}
                theme="light"
                onToggleTheme={onToggleTheme}
                onChangeCwd={vi.fn()}
                onNewSession={vi.fn()}
                onSelectSession={vi.fn()}
                onDeleteSession={vi.fn()}
                onOpenSessionById={vi.fn().mockResolvedValue(true)}
                onRenameSession={vi.fn()}
            />,
        );

        expect(toggleBtn).toHaveTextContent("Тёмная тема");
        expect(toggleBtn).toHaveAttribute("title", "Тёмная тема");
    });
});
