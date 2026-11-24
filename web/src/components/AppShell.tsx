import { Menu, Moon, RefreshCw, Settings, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
    const [settingsOpen, setSettingsOpen] = useState(false);
    const settingsRef = useRef<HTMLDivElement | null>(null);

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
        openSessionById,
        sendPrompt,
        cancelPrompt,
        selectMode,
        selectModel,
        setConfigOption,
        renameSession,
        respondPermission,
        loadMoreHistory,
    } = useAcpSession();

    useEffect(() => {
        document.documentElement.setAttribute("data-theme", theme);
        setStoredTheme(theme);
    }, [theme]);

    useEffect(() => {
        if (!settingsOpen) {
            return;
        }

        function handleOutsideClick(event: MouseEvent) {
            if (
                settingsRef.current &&
                !settingsRef.current.contains(event.target as Node)
            ) {
                setSettingsOpen(false);
            }
        }

        document.addEventListener("mousedown", handleOutsideClick);
        return () => document.removeEventListener("mousedown", handleOutsideClick);
    }, [settingsOpen]);

    const isConnected = state.connectionStatus === "connected";
    const activePermission = state.pendingPermissions[0] ?? null;
    const thoughtOption = state.configOptions.find((o) => o.id === "thought_level");
    const hasAgentSettings =
        state.modes.length > 0 || state.models.length > 0 || Boolean(thoughtOption);

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
                        onOpenSessionById={async (sessionId) => {
                            const ok = await openSessionById(sessionId);
                            if (ok && isNarrowViewport()) {
                                setSidebarOpen(false);
                            }
                            return ok;
                        }}
                        onRenameSession={renameSession}
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
                            <span
                                className={[
                                    styles.statusDot,
                                    getStatusDotClass(state.connectionStatus),
                                ].join(" ")}
                                title={formatStatusLabel(state.connectionStatus)}
                                aria-label={formatStatusLabel(state.connectionStatus)}
                            />
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

                        {hasAgentSettings && (
                            <div className={styles.settingsWrapper} ref={settingsRef}>
                                <button
                                    type="button"
                                    className={styles.iconBtn}
                                    aria-label="Настройки модели и режима"
                                    aria-expanded={settingsOpen}
                                    title="Настройки модели и режима"
                                    onClick={() => setSettingsOpen((prev) => !prev)}
                                >
                                    <Settings size={17} />
                                </button>

                                {settingsOpen && (
                                    <div className={styles.settingsPopover}>
                                        {state.modes.length > 0 && (
                                            <label className={styles.settingField}>
                                                <span className={styles.settingLabel}>Режим</span>
                                                <select
                                                    className={styles.settingSelect}
                                                    value={state.currentModeId ?? ""}
                                                    disabled={state.isGenerating}
                                                    onChange={(event) =>
                                                        void selectMode(event.currentTarget.value)
                                                    }
                                                >
                                                    {state.modes.map((mode) => (
                                                        <option key={mode.id} value={mode.id}>
                                                            {mode.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                        )}

                                        {state.models.length > 0 && (
                                            <label className={styles.settingField}>
                                                <span className={styles.settingLabel}>Модель</span>
                                                <select
                                                    className={styles.settingSelect}
                                                    value={state.currentModelId ?? ""}
                                                    disabled={state.isGenerating}
                                                    onChange={(event) =>
                                                        void selectModel(event.currentTarget.value)
                                                    }
                                                >
                                                    {state.models.map((model) => (
                                                        <option
                                                            key={model.modelId}
                                                            value={model.modelId}
                                                        >
                                                            {model.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                        )}

                                        {thoughtOption && (
                                            <label className={styles.settingField}>
                                                <span className={styles.settingLabel}>
                                                    {thoughtOption.name || "Уровень размышлений"}
                                                </span>
                                                <select
                                                    className={styles.settingSelect}
                                                    value={thoughtOption.currentValue}
                                                    disabled={state.isGenerating}
                                                    onChange={(event) =>
                                                        void setConfigOption(
                                                            "thought_level",
                                                            event.currentTarget.value,
                                                        )
                                                    }
                                                >
                                                    {thoughtOption.options.map((opt) => (
                                                        <option key={opt.value} value={opt.value}>
                                                            {opt.name}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                        )}
                                    </div>
                                )}
                            </div>
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
                    onSend={(text) => void sendPrompt(text)}
                    onCancel={cancelPrompt}
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
