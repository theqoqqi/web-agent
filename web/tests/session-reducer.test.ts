import { describe, expect, test } from "vitest";
import {
    createInitialSessionState,
    DEFAULT_VISIBLE_MESSAGES,
    selectVisibleMessages,
    sessionReducer,
} from "../src/acp/session-reducer";

describe("sessionReducer", () => {
    test("склеивает agent_thought_chunk, tool_call -> tool_call_update и agent_message_chunk в один ответ ассистента", () => {
        let state = createInitialSessionState("/srv");

        state = sessionReducer(state, {
            type: "SEND_USER_MESSAGE",
            id: "u-1",
            text: "Проверь main.ts",
        });

        state = sessionReducer(state, {
            type: "SESSION_UPDATE",
            update: {
                sessionUpdate: "agent_thought_chunk",
                content: { type: "text", text: "Думаю " },
            },
        });
        state = sessionReducer(state, {
            type: "SESSION_UPDATE",
            update: {
                sessionUpdate: "agent_thought_chunk",
                content: { type: "text", text: "о файле" },
            },
        });
        state = sessionReducer(state, {
            type: "SESSION_UPDATE",
            update: {
                sessionUpdate: "tool_call",
                toolCallId: "tc-1",
                title: "Чтение файла",
                status: "in_progress",
                locations: [{ path: "/srv/main.ts", line: 10 }],
            },
        });
        state = sessionReducer(state, {
            type: "SESSION_UPDATE",
            update: {
                sessionUpdate: "tool_call_update",
                toolCallId: "tc-1",
                status: "completed",
            },
        });
        state = sessionReducer(state, {
            type: "SESSION_UPDATE",
            update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "Готово, " },
            },
        });
        state = sessionReducer(state, {
            type: "SESSION_UPDATE",
            update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "проверено." },
            },
        });

        expect(state.messages).toHaveLength(2);
        const assistant = state.messages[1];
        expect(assistant?.role).toBe("assistant");
        expect(assistant?.thought).toBe("Думаю о файле");
        expect(assistant?.content).toBe("Готово, проверено.");
        expect(assistant?.toolCalls).toEqual([
            {
                toolCallId: "tc-1",
                title: "Чтение файла",
                status: "completed",
                locations: [{ path: "/srv/main.ts", line: 10 }],
            },
        ]);
    });

    test("извлекает modes и models как при session/new, так и при session/load", () => {
        let state = createInitialSessionState("/srv");

        state = sessionReducer(state, {
            type: "START_SESSION_LOAD",
            sessionId: "sess-load-1",
            cwd: "/srv/app",
        });

        state = sessionReducer(state, {
            type: "SESSION_UPDATE",
            update: {
                sessionUpdate: "user_message_chunk",
                content: { type: "text", text: "Привет" },
            },
        });
        state = sessionReducer(state, {
            type: "SESSION_UPDATE",
            update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "Привет!" },
            },
        });

        state = sessionReducer(state, {
            type: "SESSION_READY",
            sessionId: "sess-load-1",
            cwd: "/srv/app",
            modes: {
                currentModeId: "code",
                availableModes: [
                    { id: "ask", name: "Ask" },
                    { id: "code", name: "Code" },
                ],
            },
            models: {
                currentModelId: "gemini-pro",
                availableModels: [
                    { modelId: "gemini-flash", name: "Flash" },
                    { modelId: "gemini-pro", name: "Pro" },
                ],
            },
        });

        expect(state.isLoadingSession).toBe(false);
        expect(state.sessionId).toBe("sess-load-1");
        expect(state.currentModeId).toBe("code");
        expect(state.modes).toHaveLength(2);
        expect(state.currentModelId).toBe("gemini-pro");
        expect(state.models).toHaveLength(2);
        expect(state.messages).toHaveLength(2);
    });

    test("обновляет currentModeId, availableCommands и очередь pendingPermissions", () => {
        let state = createInitialSessionState("/srv");

        state = sessionReducer(state, {
            type: "SESSION_UPDATE",
            update: {
                sessionUpdate: "current_mode_update",
                currentModeId: "architect",
            },
        });
        state = sessionReducer(state, {
            type: "SESSION_UPDATE",
            update: {
                sessionUpdate: "available_commands_update",
                availableCommands: [
                    { name: "plan", description: "Составить план" },
                ],
            },
        });
        state = sessionReducer(state, {
            type: "ENQUEUE_PERMISSION",
            item: {
                id: "perm-1",
                params: {
                    sessionId: "s-1",
                    toolCall: { toolCallId: "tc-9", title: "Run command" },
                    options: [{ optionId: "allow_once", name: "Allow" }],
                },
            },
        });

        expect(state.currentModeId).toBe("architect");
        expect(state.availableCommands).toEqual([
            { name: "plan", description: "Составить план" },
        ]);
        expect(state.pendingPermissions).toHaveLength(1);

        state = sessionReducer(state, {
            type: "RESOLVE_PERMISSION",
            id: "perm-1",
        });

        expect(state.pendingPermissions).toHaveLength(0);
    });

    test("ограничивает видимое окно последними 20 сообщениями, подгружает по 20 и сбрасывает при новом запросе", () => {
        let state = createInitialSessionState("/srv");

        for (let i = 1; i <= 50; i += 1) {
            state = sessionReducer(state, {
                type: "SESSION_UPDATE",
                update: {
                    sessionUpdate: i % 2 === 1 ? "user_message_chunk" : "agent_message_chunk",
                    content: { type: "text", text: `msg-${i}` },
                },
            });
        }

        expect(DEFAULT_VISIBLE_MESSAGES).toBe(20);

        let windowView = selectVisibleMessages(state);
        expect(windowView.visibleMessages).toHaveLength(20);
        expect(windowView.hiddenCount).toBe(30);
        expect(windowView.visibleMessages[0]?.content).toBe("msg-31");

        state = sessionReducer(state, { type: "LOAD_MORE_HISTORY" });
        windowView = selectVisibleMessages(state);
        expect(windowView.visibleMessages).toHaveLength(40);
        expect(windowView.hiddenCount).toBe(10);
        expect(windowView.visibleMessages[0]?.content).toBe("msg-11");

        state = sessionReducer(state, { type: "LOAD_MORE_HISTORY" });
        windowView = selectVisibleMessages(state);
        expect(windowView.visibleMessages).toHaveLength(50);
        expect(windowView.hiddenCount).toBe(0);

        state = sessionReducer(state, {
            type: "SEND_USER_MESSAGE",
            id: "u-51",
            text: "Новое сообщение",
        });
        windowView = selectVisibleMessages(state);
        expect(windowView.visibleMessages).toHaveLength(20);
        expect(windowView.hiddenCount).toBe(31);
        expect(windowView.visibleMessages[19]?.content).toBe("Новое сообщение");
    });

    test("фиксирует authError флаг при -32000", () => {
        let state = createInitialSessionState("/srv");
        state = sessionReducer(state, {
            type: "SEND_USER_MESSAGE",
            id: "u-1",
            text: "test",
        });

        state = sessionReducer(state, {
            type: "SET_ERROR",
            message: "Authentication required",
            isAuthError: true,
        });

        expect(state.isGenerating).toBe(false);
        expect(state.error).toEqual({
            message: "Authentication required",
            isAuthError: true,
        });
    });
});
