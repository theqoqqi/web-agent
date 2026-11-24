import { Menu, Moon, RefreshCw, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import type { ConnectionStatus } from "../acp/session-reducer";
import { useAcpSession } from "../hooks/useAcpSession";
import { getStoredTheme, setStoredTheme, type ThemeMode } from "../lib/storage";
import { ChatViewport } from "./ChatViewport";
import { PermissionModal } from "./PermissionModal";
import { PromptComposer } from "./PromptComposer";
import { SessionSidebar } from "./SessionSidebar";
import styles from "./AppShell.module.css";

export function AppShell() {
    const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme());
    const [sidebarOpen, setSidebarOpen] = useState(() => !isNarrowViewport());

    const {
        state,
        sessions,
        canLoadSession,
        visibleMessages,
        hiddenCount,
        isPending,
        reconnect,
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
    } = useAcpSession();

    useEffect(() => {
        document.documentElement.setAttribute("data-theme", theme);
        setStoredTheme(theme);
    }, [theme]);

    const isConnected = state.connectionStatus === "connected";
    const activePermission = state.pendingPermissions[0] ?? null;

    return (
        <div className={styles.shell}>
            {sidebarOpen && (
                <>
                    <div
                        className={styles.backdrop}
                        onClick={() => setSidebarOpen(false)}
                    />
                    <SessionSidebar
                        sessions={sessions}
                        activeSessionId={state.sessionId}
                        cwd={state.cwd}
                        canLoadSession={canLoadSession}
                        isConnected={isConnected}
                        onChangeCwd={updateCwd}
                        onNewSession={() => {
                            void startNewSession();
                            if (isNarrowViewport()) {
                                setSidebarOpen(false);
                            }
                        }}
                        onSelectSession={(session) => {
                            void selectStoredSession(session);
                            if (isNarrowViewport()) {
                                setSidebarOpen(false);
                            }
                        }}
                        onDeleteSession={deleteStoredSession}
                    />
                </>
            )}

            <div className={styles.main}>
                <header className={styles.header}>
                    <div className={styles.headerLeft}>
                        <button
                            type="button"
                            className={styles.iconBtn}
                            aria-label="Переключить панель сессий"
                            onClick={() => setSidebarOpen((prev) => !prev)}
                        >
                            <Menu size={18} />
                        </button>

                        <div className={styles.titleGroup}>
                            <h1 className={styles.title}>Web Agent</h1>
                            <span className={styles.statusBadge}>
                                <span
                                    className={[
                                        styles.statusDot,
                                        getStatusDotClass(state.connectionStatus),
                                    ].join(" ")}
                                />
                                <span>{formatStatusLabel(state.connectionStatus)}</span>
                            </span>
                        </div>
                    </div>

                    <div className={styles.headerRight}>
                        {state.connectionStatus === "disconnected" && (
                            <button
                                type="button"
                                className={styles.reconnectBtn}
                                onClick={() => void reconnect()}
                            >
                                <RefreshCw size={14} />
                                <span>Подключить</span>
                            </button>
                        )}

                        <button
                            type="button"
                            className={styles.iconBtn}
                            aria-label="Переключить тему"
                            title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
                            onClick={() =>
                                setTheme((prev) => (prev === "dark" ? "light" : "dark"))
                            }
                        >
                            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
                        </button>
                    </div>
                </header>

                <ChatViewport
                    messages={visibleMessages}
                    hiddenCount={hiddenCount}
                    onLoadMore={loadMoreHistory}
                    isLoadingSession={state.isLoadingSession}
                    isGenerating={state.isGenerating}
                    isPending={isPending}
                    error={state.error}
                    cwd={state.cwd}
                />

                <PromptComposer
                    isGenerating={state.isGenerating}
                    canSend={isConnected && !state.isLoadingSession}
                    availableCommands={state.availableCommands}
                    modes={state.modes}
                    currentModeId={state.currentModeId}
                    models={state.models}
                    currentModelId={state.currentModelId}
                    onSend={(text) => void sendPrompt(text)}
                    onCancel={cancelPrompt}
                    onSelectMode={(modeId) => void selectMode(modeId)}
                    onSelectModel={(modelId) => void selectModel(modelId)}
                />
            </div>

            <PermissionModal
                item={activePermission}
                cwd={state.cwd}
                onRespond={respondPermission}
            />
        </div>
    );
}

function getInitialTheme(): ThemeMode {
    const stored = getStoredTheme();

    if (stored) {
        return stored;
    }

    if (
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
        return "dark";
    }

    return "light";
}

function isNarrowViewport(): boolean {
    return typeof window !== "undefined" && window.innerWidth <= 768;
}

function getStatusDotClass(status: ConnectionStatus): string {
    switch (status) {
        case "connected":
            return styles.dotConnected ?? "";
        case "connecting":
            return styles.dotConnecting ?? "";
        default:
            return styles.dotDisconnected ?? "";
    }
}

function formatStatusLabel(status: ConnectionStatus): string {
    switch (status) {
        case "connected":
            return "подключено";
        case "connecting":
            return "подключение...";
        default:
            return "отключено";
    }
}
