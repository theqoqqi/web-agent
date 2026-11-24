import { generateUuid } from "../lib/uuid";
import type {
    AcpAvailableCommand,
    AcpModeOption,
    AcpModelOption,
    AcpPermissionRequestParams,
    AcpSessionModesState,
    AcpSessionModelsState,
    AcpSessionUpdatePayload,
    AcpToolCall,
} from "./types";

export const DEFAULT_VISIBLE_MESSAGES = 20;
export const HISTORY_LOAD_STEP = 20;

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

export interface ChatMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    thought: string;
    toolCalls: AcpToolCall[];
}

export interface PendingPermissionItem {
    id: string;
    params: AcpPermissionRequestParams;
}

export interface SessionErrorState {
    message: string;
    isAuthError: boolean;
}

export interface SessionState {
    connectionStatus: ConnectionStatus;
    sessionId: string | null;
    cwd: string;
    isLoadingSession: boolean;
    isGenerating: boolean;
    error: SessionErrorState | null;
    messages: ChatMessage[];
    visibleCount: number;
    modes: AcpModeOption[];
    currentModeId: string | null;
    models: AcpModelOption[];
    currentModelId: string | null;
    availableCommands: AcpAvailableCommand[];
    pendingPermissions: PendingPermissionItem[];
}

export type SessionAction =
    | {
          type: "SET_CONNECTION_STATUS";
          status: ConnectionStatus;
      }
    | {
          type: "SET_CWD";
          cwd: string;
      }
    | {
          type: "START_SESSION_LOAD";
          sessionId: string;
          cwd: string;
      }
    | {
          type: "RESET_CHAT";
      }
    | {
          type: "SESSION_READY";
          sessionId: string;
          cwd: string;
          modes?: AcpSessionModesState;
          models?: AcpSessionModelsState;
      }
    | {
          type: "SET_CURRENT_MODE";
          modeId: string;
      }
    | {
          type: "SET_CURRENT_MODEL";
          modelId: string;
      }
    | {
          type: "SEND_USER_MESSAGE";
          id: string;
          text: string;
      }
    | {
          type: "PROMPT_FINISHED";
      }
    | {
          type: "SET_ERROR";
          message: string;
          isAuthError?: boolean;
      }
    | {
          type: "CLEAR_ERROR";
      }
    | {
          type: "LOAD_MORE_HISTORY";
          step?: number;
      }
    | {
          type: "ENQUEUE_PERMISSION";
          item: PendingPermissionItem;
      }
    | {
          type: "RESOLVE_PERMISSION";
          id: string;
      }
    | {
          type: "SESSION_UPDATE";
          update: AcpSessionUpdatePayload;
      };

export function createInitialSessionState(cwd: string): SessionState {
    return {
        connectionStatus: "disconnected",
        sessionId: null,
        cwd,
        isLoadingSession: false,
        isGenerating: false,
        error: null,
        messages: [],
        visibleCount: DEFAULT_VISIBLE_MESSAGES,
        modes: [],
        currentModeId: null,
        models: [],
        currentModelId: null,
        availableCommands: [],
        pendingPermissions: [],
    };
}

export function selectVisibleMessages(state: SessionState): {
    visibleMessages: ChatMessage[];
    hiddenCount: number;
} {
    const total = state.messages.length;
    const startIndex = Math.max(0, total - state.visibleCount);

    return {
        visibleMessages: state.messages.slice(startIndex),
        hiddenCount: startIndex,
    };
}

export function sessionReducer(
    state: SessionState,
    action: SessionAction,
): SessionState {
    switch (action.type) {
        case "SET_CONNECTION_STATUS":
            return {
                ...state,
                connectionStatus: action.status,
                isGenerating:
                    action.status === "disconnected" ? false : state.isGenerating,
            };

        case "SET_CWD":
            return {
                ...state,
                cwd: action.cwd,
            };

        case "START_SESSION_LOAD":
            return {
                ...state,
                sessionId: action.sessionId,
                cwd: action.cwd,
                isLoadingSession: true,
                isGenerating: false,
                error: null,
                messages: [],
                visibleCount: DEFAULT_VISIBLE_MESSAGES,
                pendingPermissions: [],
            };

        case "RESET_CHAT":
            return {
                ...state,
                sessionId: null,
                isLoadingSession: false,
                isGenerating: false,
                error: null,
                messages: [],
                visibleCount: DEFAULT_VISIBLE_MESSAGES,
                availableCommands: [],
                pendingPermissions: [],
            };

        case "SESSION_READY":
            return {
                ...state,
                sessionId: action.sessionId,
                cwd: action.cwd,
                isLoadingSession: false,
                visibleCount: DEFAULT_VISIBLE_MESSAGES,
                modes: action.modes?.availableModes ?? state.modes,
                currentModeId: action.modes?.currentModeId ?? state.currentModeId,
                models: action.models?.availableModels ?? state.models,
                currentModelId: action.models?.currentModelId ?? state.currentModelId,
            };

        case "SET_CURRENT_MODE":
            return {
                ...state,
                currentModeId: action.modeId,
            };

        case "SET_CURRENT_MODEL":
            return {
                ...state,
                currentModelId: action.modelId,
            };

        case "SEND_USER_MESSAGE":
            return {
                ...state,
                isGenerating: true,
                error: null,
                visibleCount: DEFAULT_VISIBLE_MESSAGES,
                messages: [
                    ...state.messages,
                    {
                        id: action.id,
                        role: "user",
                        content: action.text,
                        thought: "",
                        toolCalls: [],
                    },
                ],
            };

        case "PROMPT_FINISHED":
            return {
                ...state,
                isGenerating: false,
            };

        case "SET_ERROR":
            return {
                ...state,
                isGenerating: false,
                isLoadingSession: false,
                error: {
                    message: action.message,
                    isAuthError: Boolean(action.isAuthError),
                },
            };

        case "CLEAR_ERROR":
            return {
                ...state,
                error: null,
            };

        case "LOAD_MORE_HISTORY": {
            const step = action.step ?? HISTORY_LOAD_STEP;
            const nextVisibleCount = Math.min(
                state.messages.length,
                state.visibleCount + step,
            );

            if (nextVisibleCount === state.visibleCount) {
                return state;
            }

            return {
                ...state,
                visibleCount: nextVisibleCount,
            };
        }

        case "ENQUEUE_PERMISSION":
            return {
                ...state,
                pendingPermissions: [...state.pendingPermissions, action.item],
            };

        case "RESOLVE_PERMISSION":
            return {
                ...state,
                pendingPermissions: state.pendingPermissions.filter(
                    (item) => item.id !== action.id,
                ),
            };

        case "SESSION_UPDATE":
            return applySessionUpdate(state, action.update);
    }
}

function applySessionUpdate(
    state: SessionState,
    update: AcpSessionUpdatePayload,
): SessionState {
    switch (update.sessionUpdate) {
        case "user_message_chunk":
            return {
                ...state,
                messages: appendUserChunk(state.messages, update.content.text),
            };

        case "agent_message_chunk":
            return {
                ...state,
                messages: updateLastAssistant(state.messages, (assistant) => ({
                    ...assistant,
                    content: assistant.content + update.content.text,
                })),
            };

        case "agent_thought_chunk":
            return {
                ...state,
                messages: updateLastAssistant(state.messages, (assistant) => ({
                    ...assistant,
                    thought: assistant.thought + update.content.text,
                })),
            };

        case "tool_call":
        case "tool_call_update":
            return {
                ...state,
                messages: updateLastAssistant(state.messages, (assistant) => ({
                    ...assistant,
                    toolCalls: upsertToolCall(assistant.toolCalls, update),
                })),
            };

        case "current_mode_update":
            return {
                ...state,
                currentModeId: update.currentModeId,
            };

        case "available_commands_update":
            return {
                ...state,
                availableCommands: update.availableCommands,
            };
    }
}

function appendUserChunk(
    messages: ChatMessage[],
    text: string,
): ChatMessage[] {
    const last = messages[messages.length - 1];

    if (last && last.role === "user") {
        return [
            ...messages.slice(0, -1),
            {
                ...last,
                content: last.content + text,
            },
        ];
    }

    return [
        ...messages,
        {
            id: generateUuid(),
            role: "user",
            content: text,
            thought: "",
            toolCalls: [],
        },
    ];
}

function updateLastAssistant(
    messages: ChatMessage[],
    updater: (assistant: ChatMessage) => ChatMessage,
): ChatMessage[] {
    const last = messages[messages.length - 1];

    if (last && last.role === "assistant") {
        return [...messages.slice(0, -1), updater(last)];
    }

    const created: ChatMessage = {
        id: generateUuid(),
        role: "assistant",
        content: "",
        thought: "",
        toolCalls: [],
    };

    return [...messages, updater(created)];
}

function upsertToolCall(
    existingList: AcpToolCall[],
    incoming: Extract<AcpSessionUpdatePayload, { sessionUpdate: "tool_call" | "tool_call_update" }>,
): AcpToolCall[] {
    const index = existingList.findIndex(
        (item) => item.toolCallId === incoming.toolCallId,
    );
    const current = index >= 0 ? existingList[index] : undefined;

    const merged: AcpToolCall = {
        toolCallId: incoming.toolCallId,
        title: incoming.title ?? current?.title,
        kind: incoming.kind ?? current?.kind,
        status: incoming.status ?? current?.status,
        content: incoming.content ?? current?.content,
        locations: incoming.locations ?? current?.locations,
        rawInput: incoming.rawInput ?? current?.rawInput,
        rawOutput: incoming.rawOutput ?? current?.rawOutput,
    };

    if (index === -1) {
        return [...existingList, merged];
    }

    return [
        ...existingList.slice(0, index),
        merged,
        ...existingList.slice(index + 1),
    ];
}
