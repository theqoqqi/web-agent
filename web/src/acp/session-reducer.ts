import { generateUuid } from "../lib/uuid";
import type {
    AcpAvailableCommand,
    AcpConfigOption,
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

export type AgentStepItem =
    | {
          kind: "thought";
          id: string;
          text: string;
      }
    | {
          kind: "tool_call";
          toolCall: AcpToolCall;
      };

export type MessageBlock =
    | {
          kind: "text";
          id: string;
          text: string;
      }
    | {
          kind: "steps";
          id: string;
          items: AgentStepItem[];
      };

export interface ChatMessage {
    id: string;
    role: "user" | "assistant";
    blocks: MessageBlock[];
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
    configOptions: AcpConfigOption[];
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
          configOptions?: AcpConfigOption[];
      }
    | {
          type: "SET_CONFIG_OPTIONS";
          configOptions: AcpConfigOption[];
      }
    | {
          type: "SET_CONFIG_OPTION_VALUE";
          configId: string;
          value: string;
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
        configOptions: [],
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
                configOptions: [],
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
                configOptions: action.configOptions ?? state.configOptions,
            };

        case "SET_CONFIG_OPTIONS":
            return {
                ...state,
                configOptions: action.configOptions,
            };

        case "SET_CONFIG_OPTION_VALUE":
            return {
                ...state,
                configOptions: state.configOptions.map((opt) =>
                    opt.id === action.configId
                        ? { ...opt, currentValue: action.value }
                        : opt,
                ),
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
                        blocks: [
                            {
                                kind: "text",
                                id: generateUuid(),
                                text: action.text,
                            },
                        ],
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

        default:
            return state;
    }
}

function applySessionUpdate(
    state: SessionState,
    update: AcpSessionUpdatePayload,
): SessionState {
    if (!update || typeof update !== "object") {
        return state;
    }

    switch (update.sessionUpdate) {
        case "user_message_chunk": {
            const text = extractChunkText(update.content);

            if (text === null) {
                return state;
            }

            return {
                ...state,
                messages: appendUserChunk(state.messages, text),
            };
        }

        case "agent_message_chunk": {
            const text = extractChunkText(update.content);

            if (text === null) {
                return state;
            }

            return {
                ...state,
                messages: updateLastAssistant(state.messages, (assistant) => ({
                    ...assistant,
                    blocks: appendTextBlock(assistant.blocks, text),
                })),
            };
        }

        case "agent_thought_chunk": {
            const text = extractChunkText(update.content);

            if (text === null) {
                return state;
            }

            return {
                ...state,
                messages: updateLastAssistant(state.messages, (assistant) => ({
                    ...assistant,
                    blocks: appendThoughtStep(assistant.blocks, text),
                })),
            };
        }

        case "tool_call":
        case "tool_call_update":
            if (typeof update.toolCallId !== "string") {
                return state;
            }

            return {
                ...state,
                messages: updateLastAssistant(state.messages, (assistant) => ({
                    ...assistant,
                    blocks: upsertToolCallStep(assistant.blocks, update),
                })),
            };

        case "current_mode_update":
            if (typeof update.currentModeId !== "string") {
                return state;
            }

            return {
                ...state,
                currentModeId: update.currentModeId,
            };

        case "available_commands_update":
            if (!Array.isArray(update.availableCommands)) {
                return state;
            }

            return {
                ...state,
                availableCommands: update.availableCommands,
            };

        default:
            return state;
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
                blocks: appendTextBlock(last.blocks, text),
            },
        ];
    }

    return [
        ...messages,
        {
            id: generateUuid(),
            role: "user",
            blocks: [
                {
                    kind: "text",
                    id: generateUuid(),
                    text,
                },
            ],
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
        blocks: [],
    };

    return [...messages, updater(created)];
}

function appendTextBlock(
    blocks: MessageBlock[],
    text: string,
): MessageBlock[] {
    const last = blocks[blocks.length - 1];

    if (last && last.kind === "text") {
        return [
            ...blocks.slice(0, -1),
            {
                ...last,
                text: last.text + text,
            },
        ];
    }

    return [
        ...blocks,
        {
            kind: "text",
            id: generateUuid(),
            text,
        },
    ];
}

function appendThoughtStep(
    blocks: MessageBlock[],
    text: string,
): MessageBlock[] {
    const lastBlock = blocks[blocks.length - 1];

    if (lastBlock && lastBlock.kind === "steps") {
        const lastItem = lastBlock.items[lastBlock.items.length - 1];
        const nextItems: AgentStepItem[] =
            lastItem && lastItem.kind === "thought"
                ? [
                      ...lastBlock.items.slice(0, -1),
                      {
                          ...lastItem,
                          text: lastItem.text + text,
                      },
                  ]
                : [
                      ...lastBlock.items,
                      {
                          kind: "thought",
                          id: generateUuid(),
                          text,
                      },
                  ];

        return [
            ...blocks.slice(0, -1),
            {
                ...lastBlock,
                items: nextItems,
            },
        ];
    }

    return [
        ...blocks,
        {
            kind: "steps",
            id: generateUuid(),
            items: [
                {
                    kind: "thought",
                    id: generateUuid(),
                    text,
                },
            ],
        },
    ];
}

function upsertToolCallStep(
    blocks: MessageBlock[],
    incoming: Extract<AcpSessionUpdatePayload, { sessionUpdate: "tool_call" | "tool_call_update" }>,
): MessageBlock[] {
    for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
        const block = blocks[blockIndex];

        if (!block || block.kind !== "steps") {
            continue;
        }

        const itemIndex = block.items.findIndex(
            (item) => item.kind === "tool_call" && item.toolCall.toolCallId === incoming.toolCallId,
        );

        if (itemIndex === -1) {
            continue;
        }

        const existingItem = block.items[itemIndex];

        if (!existingItem || existingItem.kind !== "tool_call") {
            continue;
        }

        const nextItems = [
            ...block.items.slice(0, itemIndex),
            {
                kind: "tool_call" as const,
                toolCall: mergeToolCall(existingItem.toolCall, incoming),
            },
            ...block.items.slice(itemIndex + 1),
        ];

        return [
            ...blocks.slice(0, blockIndex),
            {
                ...block,
                items: nextItems,
            },
            ...blocks.slice(blockIndex + 1),
        ];
    }

    const newItem: AgentStepItem = {
        kind: "tool_call",
        toolCall: mergeToolCall(undefined, incoming),
    };
    const lastBlock = blocks[blocks.length - 1];

    if (lastBlock && lastBlock.kind === "steps") {
        return [
            ...blocks.slice(0, -1),
            {
                ...lastBlock,
                items: [...lastBlock.items, newItem],
            },
        ];
    }

    return [
        ...blocks,
        {
            kind: "steps",
            id: generateUuid(),
            items: [newItem],
        },
    ];
}

function mergeToolCall(
    current: AcpToolCall | undefined,
    incoming: Extract<AcpSessionUpdatePayload, { sessionUpdate: "tool_call" | "tool_call_update" }>,
): AcpToolCall {
    return {
        toolCallId: incoming.toolCallId,
        title: incoming.title ?? current?.title,
        kind: incoming.kind ?? current?.kind,
        status: incoming.status ?? current?.status,
        content: incoming.content ?? current?.content,
        locations: incoming.locations ?? current?.locations,
        rawInput: incoming.rawInput ?? current?.rawInput,
        rawOutput: incoming.rawOutput ?? current?.rawOutput,
    };
}

function extractChunkText(content: unknown): string | null {
    if (typeof content !== "object" || content === null) {
        return null;
    }

    const record = content as { text?: unknown };
    return typeof record.text === "string" ? record.text : null;
}
