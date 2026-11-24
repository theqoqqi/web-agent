import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { AcpRpcClient, JsonRpcResponseError } from "../acp/rpc-client";
import {
    createInitialSessionState,
    selectVisibleMessages,
    sessionReducer,
} from "../acp/session-reducer";
import type {
    AcpInitializeResult,
    AcpLoadSessionResult,
    AcpNewSessionResult,
    AcpPermissionRequestParams,
    AcpPermissionResponse,
    AcpSessionUpdateParams,
} from "../acp/types";
import { AcpWsTransport } from "../acp/ws-transport";
import {
    DEFAULT_CWD,
    getStoredCwd,
    getStoredSessions,
    removeStoredSession,
    setStoredCwd,
    upsertStoredSession,
    type StoredSession,
} from "../lib/storage";
import { generateUuid } from "../lib/uuid";

export function useAcpSession() {
    const [state, dispatch] = useReducer(
        sessionReducer,
        undefined,
        () => createInitialSessionState(getStoredCwd()),
    );
    const [sessions, setSessions] = useState<StoredSession[]>(() => getStoredSessions());
    const [canLoadSession, setCanLoadSession] = useState(false);

    const transportRef = useRef<AcpWsTransport | null>(null);
    const clientRef = useRef<AcpRpcClient | null>(null);
    const connectingRef = useRef(false);
    const disposedRef = useRef(false);
    const authBlockedRef = useRef(false);
    const activeSessionIdRef = useRef<string | null>(null);
    const activeCwdRef = useRef<string>(state.cwd);
    const canLoadSessionRef = useRef(false);
    const permissionResolversRef = useRef(
        new Map<string, (res: AcpPermissionResponse) => void>(),
    );

    activeSessionIdRef.current = state.sessionId;
    activeCwdRef.current = state.cwd;
    canLoadSessionRef.current = canLoadSession;

    const clearPendingPermissions = useCallback(() => {
        for (const [id, resolve] of permissionResolversRef.current.entries()) {
            permissionResolversRef.current.delete(id);
            resolve({ outcome: { outcome: "cancelled" } });
            dispatch({ type: "RESOLVE_PERMISSION", id });
        }
    }, []);

    const teardownTransport = useCallback(() => {
        clearPendingPermissions();
        clientRef.current?.dispose();
        clientRef.current = null;
        transportRef.current?.close();
        transportRef.current = null;
    }, [clearPendingPermissions]);

    const handleSessionError = useCallback((err: unknown, fallbackMessage: string) => {
        const isAuthError = err instanceof JsonRpcResponseError && err.code === -32000;

        if (isAuthError) {
            authBlockedRef.current = true;
        }

        const message = err instanceof Error ? err.message : fallbackMessage;
        dispatch({
            type: "SET_ERROR",
            message,
            isAuthError,
        });
    }, []);

    const createNewSessionOnClient = useCallback(
        async (client: AcpRpcClient, cwd: string): Promise<string> => {
            const normalizedCwd = normalizeCwd(cwd);
            dispatch({ type: "RESET_CHAT" });

            const result = await client.request<AcpNewSessionResult>("session/new", {
                cwd: normalizedCwd,
                mcpServers: [],
            });

            activeSessionIdRef.current = result.sessionId;
            dispatch({
                type: "SESSION_READY",
                sessionId: result.sessionId,
                cwd: normalizedCwd,
                modes: result.modes,
                models: result.models,
            });

            return result.sessionId;
        },
        [],
    );

    const loadExistingSessionOnClient = useCallback(
        async (
            client: AcpRpcClient,
            sessionId: string,
            cwd: string,
        ): Promise<void> => {
            const normalizedCwd = normalizeCwd(cwd);
            activeSessionIdRef.current = sessionId;
            dispatch({
                type: "START_SESSION_LOAD",
                sessionId,
                cwd: normalizedCwd,
            });

            const result = await client.request<AcpLoadSessionResult>("session/load", {
                sessionId,
                cwd: normalizedCwd,
                mcpServers: [],
            });

            dispatch({
                type: "SESSION_READY",
                sessionId,
                cwd: normalizedCwd,
                modes: result.modes,
                models: result.models,
            });
        },
        [],
    );

    const connect = useCallback(async () => {
        if (connectingRef.current || disposedRef.current || transportRef.current?.isOpen()) {
            return;
        }

        connectingRef.current = true;
        authBlockedRef.current = false;
        teardownTransport();
        dispatch({ type: "SET_CONNECTION_STATUS", status: "connecting" });

        try {
            const transport = new AcpWsTransport({
                url: buildWebSocketUrl("/ws"),
            });
            transportRef.current = transport;

            transport.onClose(() => {
                if (transportRef.current === transport) {
                    clearPendingPermissions();
                    dispatch({ type: "SET_CONNECTION_STATUS", status: "disconnected" });
                }
            });

            const client = new AcpRpcClient(transport, {
                onNotification: (method, params) => {
                    if (method !== "session/update" || !params) {
                        return;
                    }

                    const payload = params as AcpSessionUpdateParams;

                    if (
                        !payload.update ||
                        (activeSessionIdRef.current &&
                            payload.sessionId !== activeSessionIdRef.current)
                    ) {
                        return;
                    }

                    dispatch({
                        type: "SESSION_UPDATE",
                        update: payload.update,
                    });
                },
                onRequest: async (method, params) => {
                    if (method !== "session/request_permission") {
                        throw new Error(`Unsupported request: ${method}`);
                    }

                    const id = generateUuid();
                    const reqParams = params as AcpPermissionRequestParams;

                    return new Promise<AcpPermissionResponse>((resolve) => {
                        permissionResolversRef.current.set(id, resolve);
                        dispatch({
                            type: "ENQUEUE_PERMISSION",
                            item: {
                                id,
                                params: reqParams,
                            },
                        });
                    });
                },
            });
            clientRef.current = client;

            await transport.connect();

            if (disposedRef.current) {
                teardownTransport();
                return;
            }

            const initResult = await client.request<AcpInitializeResult>("initialize", {
                protocolVersion: 1,
                clientCapabilities: {
                    fs: {
                        readTextFile: false,
                        writeTextFile: false,
                    },
                },
                clientInfo: {
                    name: "web-agent-ui",
                    title: "Web Agent UI",
                    version: "0.1.0",
                },
            });

            const loadSupported = Boolean(initResult.agentCapabilities?.loadSession);
            setCanLoadSession(loadSupported);
            canLoadSessionRef.current = loadSupported;
            dispatch({ type: "SET_CONNECTION_STATUS", status: "connected" });

            const existingSessionId = activeSessionIdRef.current;

            if (existingSessionId && loadSupported) {
                await loadExistingSessionOnClient(
                    client,
                    existingSessionId,
                    activeCwdRef.current,
                );
            } else {
                await createNewSessionOnClient(client, activeCwdRef.current);
            }
        } catch (err) {
            dispatch({ type: "SET_CONNECTION_STATUS", status: "disconnected" });
            handleSessionError(err, "Не удалось подключиться к серверу");
        } finally {
            connectingRef.current = false;
        }
    }, [
        clearPendingPermissions,
        createNewSessionOnClient,
        handleSessionError,
        loadExistingSessionOnClient,
        teardownTransport,
    ]);

    useEffect(() => {
        disposedRef.current = false;
        void connect();

        function handleResumeVisibility() {
            if (document.visibilityState === "hidden") {
                return;
            }

            if (
                !authBlockedRef.current &&
                !connectingRef.current &&
                !transportRef.current?.isOpen()
            ) {
                void connect();
            }
        }

        document.addEventListener("visibilitychange", handleResumeVisibility);
        window.addEventListener("pageshow", handleResumeVisibility);

        return () => {
            disposedRef.current = true;
            document.removeEventListener("visibilitychange", handleResumeVisibility);
            window.removeEventListener("pageshow", handleResumeVisibility);
            teardownTransport();
        };
    }, [connect, teardownTransport]);

    const updateCwd = useCallback((nextCwd: string) => {
        dispatch({ type: "SET_CWD", cwd: nextCwd });
        setStoredCwd(nextCwd);
    }, []);

    const startNewSession = useCallback(async () => {
        const client = clientRef.current;

        if (!client || !transportRef.current?.isOpen()) {
            return;
        }

        try {
            await createNewSessionOnClient(client, activeCwdRef.current);
        } catch (err) {
            handleSessionError(err, "Не удалось создать новую сессию");
        }
    }, [createNewSessionOnClient, handleSessionError]);

    const selectStoredSession = useCallback(
        async (session: StoredSession) => {
            const client = clientRef.current;

            if (!client || !transportRef.current?.isOpen() || !canLoadSessionRef.current) {
                return;
            }

            dispatch({ type: "SET_CWD", cwd: session.cwd });
            setStoredCwd(session.cwd);

            try {
                await loadExistingSessionOnClient(client, session.sessionId, session.cwd);
            } catch (err) {
                handleSessionError(err, "Не удалось загрузить сессию");
            }
        },
        [handleSessionError, loadExistingSessionOnClient],
    );

    const deleteStoredSession = useCallback((sessionId: string) => {
        setSessions(removeStoredSession(sessionId));
    }, []);

    const sendPrompt = useCallback(
        async (text: string) => {
            const client = clientRef.current;

            if (!client || !transportRef.current?.isOpen()) {
                dispatch({
                    type: "SET_ERROR",
                    message: "Нет соединения с сервером",
                });
                return;
            }

            const normalizedCwd = normalizeCwd(activeCwdRef.current);

            try {
                let targetSessionId = activeSessionIdRef.current;

                if (!targetSessionId) {
                    targetSessionId = await createNewSessionOnClient(client, normalizedCwd);
                }

                const existingTitle = getStoredSessions().find(
                    (item) => item.sessionId === targetSessionId,
                )?.title;
                const title = existingTitle || buildSessionTitle(text);

                setSessions(
                    upsertStoredSession({
                        sessionId: targetSessionId,
                        cwd: normalizedCwd,
                        title,
                        updatedAt: Date.now(),
                    }),
                );

                dispatch({
                    type: "SEND_USER_MESSAGE",
                    id: generateUuid(),
                    text,
                });

                await client.request("session/prompt", {
                    sessionId: targetSessionId,
                    prompt: [{ type: "text", text }],
                });

                dispatch({ type: "PROMPT_FINISHED" });
            } catch (err) {
                handleSessionError(err, "Ошибка выполнения запроса");
            }
        },
        [createNewSessionOnClient, handleSessionError],
    );

    const cancelPrompt = useCallback(() => {
        const client = clientRef.current;
        const sessionId = activeSessionIdRef.current;

        if (client && sessionId && transportRef.current?.isOpen()) {
            client.notify("session/cancel", { sessionId });
        }

        dispatch({ type: "PROMPT_FINISHED" });
    }, []);

    const selectMode = useCallback(
        async (modeId: string) => {
            const client = clientRef.current;
            const sessionId = activeSessionIdRef.current;

            if (!client || !sessionId) {
                return;
            }

            dispatch({ type: "SET_CURRENT_MODE", modeId });

            try {
                await client.request("session/set_mode", {
                    sessionId,
                    modeId,
                });
            } catch (err) {
                handleSessionError(err, "Не удалось сменить режим");
            }
        },
        [handleSessionError],
    );

    const selectModel = useCallback(
        async (modelId: string) => {
            const client = clientRef.current;
            const sessionId = activeSessionIdRef.current;

            if (!client || !sessionId) {
                return;
            }

            dispatch({ type: "SET_CURRENT_MODEL", modelId });

            try {
                await client.request("session/set_model", {
                    sessionId,
                    modelId,
                });
            } catch (err) {
                handleSessionError(err, "Не удалось сменить модель");
            }
        },
        [handleSessionError],
    );

    const respondPermission = useCallback(
        (id: string, response: AcpPermissionResponse) => {
            const resolver = permissionResolversRef.current.get(id);

            if (resolver) {
                permissionResolversRef.current.delete(id);
                resolver(response);
            }

            dispatch({ type: "RESOLVE_PERMISSION", id });
        },
        [],
    );

    const loadMoreHistory = useCallback(() => {
        dispatch({ type: "LOAD_MORE_HISTORY" });
    }, []);

    const { visibleMessages, hiddenCount } = selectVisibleMessages(state);
    const lastMessage = state.messages[state.messages.length - 1];
    const isPending = state.isGenerating && (!lastMessage || lastMessage.role === "user");

    return {
        state,
        sessions,
        canLoadSession,
        visibleMessages,
        hiddenCount,
        isPending,
        reconnect: connect,
        updateCwd,
        startNewSession,
        selectStoredSession,
        deleteStoredSession,
        sendPrompt,
        cancelPrompt,
        selectMode,
        selectModel,
        respondPermission,
        loadMoreHistory,
    };
}

function buildWebSocketUrl(path: string): string {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}${path}`;
}

function normalizeCwd(raw: string): string {
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : DEFAULT_CWD;
}

function buildSessionTitle(promptText: string): string {
    const firstLine = promptText.split(/\r?\n/)[0]?.trim() ?? "";
    if (firstLine.length <= 48) {
        return firstLine || "Новая сессия";
    }

    return `${firstLine.slice(0, 45)}...`;
}
