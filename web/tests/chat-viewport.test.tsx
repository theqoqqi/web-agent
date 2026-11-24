import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AgentStepItem, ChatMessage } from "../src/acp/session-reducer";
import { AgentSteps } from "../src/components/AgentSteps";
import { ChatViewport } from "../src/components/ChatViewport";
import { MessageItem } from "../src/components/MessageItem";

function createMessages(count: number): ChatMessage[] {
    return Array.from({ length: count }, (_, index) => ({
        id: `m-${index + 1}`,
        role: index % 2 === 0 ? "user" : "assistant",
        blocks: [
            {
                kind: "text",
                id: `b-${index + 1}`,
                text: `Сообщение ${index + 1}`,
            },
        ],
    }));
}

describe("ChatViewport and MessageItem", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    test("подгружает старые сообщения при прокрутке вверх и компенсирует scrollTop на прирост scrollHeight", () => {
        const visibleFirst = createMessages(20).map((m, i) => ({
            ...m,
            id: `m-${i + 11}`,
            blocks: [
                {
                    kind: "text" as const,
                    id: `b-${i + 11}`,
                    text: `Сообщение ${i + 11}`,
                },
            ],
        }));
        const visibleAfter = createMessages(30);
        const onLoadMore = vi.fn();

        const { container, rerender } = render(
            <ChatViewport
                messages={visibleFirst}
                hiddenCount={10}
                onLoadMore={onLoadMore}
                isLoadingSession={false}
                isGenerating={false}
                isPending={false}
                error={null}
                cwd="/srv"
            />,
        );

        const scrollEl = container.querySelector('[role="log"]') as HTMLElement;
        let currentScrollHeight = 1000;
        let currentScrollTop = 500;

        Object.defineProperty(scrollEl, "clientHeight", {
            value: 400,
            configurable: true,
        });
        Object.defineProperty(scrollEl, "scrollHeight", {
            get: () => currentScrollHeight,
            configurable: true,
        });
        Object.defineProperty(scrollEl, "scrollTop", {
            get: () => currentScrollTop,
            set: (val: number) => {
                currentScrollTop = val;
            },
            configurable: true,
        });

        currentScrollTop = 20;
        fireEvent.scroll(scrollEl);
        expect(onLoadMore).toHaveBeenCalledTimes(1);

        currentScrollHeight = 1450;
        rerender(
            <ChatViewport
                messages={visibleAfter}
                hiddenCount={0}
                onLoadMore={onLoadMore}
                isLoadingSession={false}
                isGenerating={false}
                isPending={false}
                error={null}
                cwd="/srv"
            />,
        );

        expect(currentScrollTop).toBe(470);
    });

    test("отключает автоскролл при прокрутке вверх и возвращает его кнопкой «Вниз»", () => {
        const initial = createMessages(3);
        const updated = [
            ...initial,
            {
                id: "m-4",
                role: "assistant" as const,
                blocks: [
                    {
                        kind: "text" as const,
                        id: "b-4",
                        text: "Новый стрим-чанк",
                    },
                ],
            },
        ];

        const { container, rerender } = render(
            <ChatViewport
                messages={initial}
                hiddenCount={0}
                onLoadMore={() => {}}
                isLoadingSession={false}
                isGenerating={true}
                isPending={false}
                error={null}
                cwd="/srv"
            />,
        );

        const scrollEl = container.querySelector('[role="log"]') as HTMLElement;
        let currentScrollHeight = 1000;
        let currentScrollTop = 600;

        Object.defineProperty(scrollEl, "clientHeight", {
            value: 400,
            configurable: true,
        });
        Object.defineProperty(scrollEl, "scrollHeight", {
            get: () => currentScrollHeight,
            configurable: true,
        });
        Object.defineProperty(scrollEl, "scrollTop", {
            get: () => currentScrollTop,
            set: (val: number) => {
                currentScrollTop = val;
            },
            configurable: true,
        });

        currentScrollTop = 100;
        fireEvent.scroll(scrollEl);

        const scrollDownBtn = screen.getByRole("button", { name: /Вниз/i });
        expect(scrollDownBtn).toBeInTheDocument();

        currentScrollHeight = 1200;
        rerender(
            <ChatViewport
                messages={updated}
                hiddenCount={0}
                onLoadMore={() => {}}
                isLoadingSession={false}
                isGenerating={true}
                isPending={false}
                error={null}
                cwd="/srv"
            />,
        );

        expect(currentScrollTop).toBe(100);

        fireEvent.click(scrollDownBtn);
        expect(currentScrollTop).toBe(1200);
        expect(screen.queryByRole("button", { name: /Вниз/i })).toBeNull();
    });

    test("держит AgentSteps развёрнутым во время генерации, сворачивает по завершении и рендерит /files?path=...", () => {
        const runningItems: AgentStepItem[] = [
            {
                kind: "thought",
                id: "t-1",
                text: "Анализирую файл",
            },
            {
                kind: "tool_call",
                toolCall: {
                    toolCallId: "tc-1",
                    title: "Чтение файла",
                    status: "in_progress",
                    locations: [{ path: "/srv/app.ts", line: 25 }],
                },
            },
        ];

        const { rerender } = render(
            <AgentSteps
                items={runningItems}
                isGenerating={true}
                cwd="/srv"
            />,
        );

        const toggleRunning = screen.getByRole("button");
        expect(toggleRunning).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByText("Анализирую файл")).toBeInTheDocument();

        const completedItems: AgentStepItem[] = [
            runningItems[0]!,
            {
                kind: "tool_call",
                toolCall: {
                    toolCallId: "tc-1",
                    title: "Чтение файла",
                    status: "completed",
                    locations: [{ path: "/srv/app.ts", line: 25 }],
                },
            },
        ];

        rerender(
            <AgentSteps
                items={completedItems}
                isGenerating={false}
                cwd="/srv"
            />,
        );

        const toggleDone = screen.getByRole("button", { name: /Размышления и 1 действие/i });
        expect(toggleDone).toHaveAttribute("aria-expanded", "false");

        fireEvent.click(toggleDone);
        expect(toggleDone).toHaveAttribute("aria-expanded", "true");
        const locationLink = screen.getByRole("link", { name: /app\.ts:25/i });
        expect(locationLink).toHaveAttribute("href", "/files?path=%2Fsrv%2Fapp.ts#L25");
        expect(locationLink).toHaveAttribute("target", "_blank");
    });

    test("копирует текст сообщения по нажатию на кнопку копирования", async () => {
        const execCommandSpy = vi.fn(() => true);
        Object.defineProperty(navigator, "clipboard", {
            value: undefined,
            configurable: true,
        });
        Object.defineProperty(document, "execCommand", {
            value: execCommandSpy,
            configurable: true,
        });

        render(
            <MessageItem
                message={{
                    id: "m-1",
                    role: "assistant",
                    blocks: [
                        {
                            kind: "text",
                            id: "b-1",
                            text: "Готовый ответ ассистента",
                        },
                    ],
                }}
                isGenerating={false}
                cwd="/srv"
            />,
        );

        const copyButton = screen.getByRole("button", { name: /Копировать сообщение/i });
        fireEvent.click(copyButton);

        await waitFor(() => {
            expect(execCommandSpy).toHaveBeenCalledWith("copy");
        });
    });
});
