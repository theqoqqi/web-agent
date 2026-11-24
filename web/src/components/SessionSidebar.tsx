import { Check, FolderInput, Moon, Pencil, Plus, Sun, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { StoredSession, ThemeMode } from "../lib/storage";
import styles from "./SessionSidebar.module.css";

export interface SessionSidebarProps {
    sessions: StoredSession[];
    activeSessionId: string | null;
    cwd: string;
    canLoadSession: boolean;
    isConnected: boolean;
    theme: ThemeMode;
    onToggleTheme: () => void;
    onChangeCwd: (cwd: string) => void;
    onNewSession: () => void;
    onSelectSession: (session: StoredSession) => void;
    onDeleteSession: (sessionId: string) => void;
    onOpenSessionById: (sessionId: string) => Promise<boolean>;
    onRenameSession: (sessionId: string, newTitle: string) => void;
}

export function SessionSidebar({
    sessions,
    activeSessionId,
    cwd,
    canLoadSession,
    isConnected,
    theme,
    onToggleTheme,
    onChangeCwd,
    onNewSession,
    onSelectSession,
    onDeleteSession,
    onOpenSessionById,
    onRenameSession,
}: SessionSidebarProps) {
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [importId, setImportId] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState("");

    async function handleImportSubmit(event: FormEvent) {
        event.preventDefault();
        const trimmed = importId.trim();

        if (!trimmed) {
            return;
        }

        setIsSubmitting(true);
        const ok = await onOpenSessionById(trimmed);
        setIsSubmitting(false);

        if (ok) {
            setIsImportOpen(false);
            setImportId("");
        }
    }

    function startEditing(session: StoredSession) {
        setEditingSessionId(session.sessionId);
        setEditingTitle(session.title || session.sessionId);
    }

    function saveEditing() {
        if (!editingSessionId) {
            return;
        }

        onRenameSession(editingSessionId, editingTitle);
        setEditingSessionId(null);
        setEditingTitle("");
    }

    function cancelEditing() {
        setEditingSessionId(null);
        setEditingTitle("");
    }

    return (
        <aside className={styles.sidebar} aria-label="Список сессий">
            <div className={styles.top}>
                <div className={styles.actionRow}>
                    <button
                        type="button"
                        className={styles.newChatBtn}
                        disabled={!isConnected}
                        onClick={onNewSession}
                    >
                        <Plus size={16} />
                        <span>Новый чат</span>
                    </button>

                    <button
                        type="button"
                        className={styles.openByIdToggleBtn}
                        disabled={!isConnected || !canLoadSession}
                        title="Открыть существующую сессию по ID"
                        aria-label="Открыть существующую сессию по ID"
                        aria-expanded={isImportOpen}
                        onClick={() => setIsImportOpen((prev) => !prev)}
                    >
                        <FolderInput size={16} />
                    </button>
                </div>

                {isImportOpen && (
                    <form className={styles.importForm} onSubmit={handleImportSubmit}>
                        <input
                            type="text"
                            className={styles.importInput}
                            placeholder="UUID сессии..."
                            value={importId}
                            disabled={isSubmitting}
                            autoFocus
                            onChange={(event) => setImportId(event.currentTarget.value)}
                        />
                        <div className={styles.importActions}>
                            <button
                                type="submit"
                                className={styles.importSubmitBtn}
                                disabled={isSubmitting || importId.trim().length === 0}
                            >
                                {isSubmitting ? "Загрузка..." : "Открыть"}
                            </button>
                            <button
                                type="button"
                                className={styles.importCancelBtn}
                                disabled={isSubmitting}
                                onClick={() => {
                                    setIsImportOpen(false);
                                    setImportId("");
                                }}
                            >
                                Отмена
                            </button>
                        </div>
                    </form>
                )}

                <label className={styles.cwdGroup}>
                    <span className={styles.cwdLabel}>Рабочий каталог (cwd)</span>
                    <input
                        type="text"
                        className={styles.cwdInput}
                        value={cwd}
                        placeholder="/srv"
                        onChange={(event) => onChangeCwd(event.currentTarget.value)}
                    />
                </label>
            </div>

            <div className={styles.list}>
                {sessions.length === 0 ? (
                    <div className={styles.emptyList}>Сохранённых сессий пока нет</div>
                ) : (
                    sessions.map((session) => {
                        const isActive = session.sessionId === activeSessionId;
                        const isEditing = session.sessionId === editingSessionId;

                        if (isEditing) {
                            return (
                                <div
                                    key={session.sessionId}
                                    className={[
                                        styles.sessionItem,
                                        styles.sessionItemEditing,
                                    ].join(" ")}
                                >
                                    <input
                                        type="text"
                                        className={styles.renameInput}
                                        value={editingTitle}
                                        autoFocus
                                        onChange={(event) =>
                                            setEditingTitle(event.currentTarget.value)
                                        }
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter") {
                                                event.preventDefault();
                                                saveEditing();
                                            } else if (event.key === "Escape") {
                                                cancelEditing();
                                            }
                                        }}
                                    />
                                    <button
                                        type="button"
                                        className={styles.actionIconBtn}
                                        title="Сохранить"
                                        aria-label="Сохранить название"
                                        onClick={saveEditing}
                                    >
                                        <Check size={14} />
                                    </button>
                                    <button
                                        type="button"
                                        className={styles.actionIconBtn}
                                        title="Отмена"
                                        aria-label="Отменить переименование"
                                        onClick={cancelEditing}
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            );
                        }

                        return (
                            <div
                                key={session.sessionId}
                                className={[
                                    styles.sessionItem,
                                    isActive ? styles.sessionItemActive : "",
                                ]
                                    .filter(Boolean)
                                    .join(" ")}
                            >
                                <button
                                    type="button"
                                    className={styles.sessionBtn}
                                    disabled={!isConnected || !canLoadSession}
                                    onClick={() => onSelectSession(session)}
                                >
                                    <span className={styles.sessionTitle}>
                                        {session.title || session.sessionId}
                                    </span>
                                    <span className={styles.sessionMeta}>{session.cwd}</span>
                                </button>

                                <div className={styles.itemActions}>
                                    <button
                                        type="button"
                                        className={styles.actionIconBtn}
                                        aria-label={`Переименовать сессию ${session.title}`}
                                        title="Переименовать"
                                        onClick={() => startEditing(session)}
                                    >
                                        <Pencil size={13} />
                                    </button>

                                    <button
                                        type="button"
                                        className={[styles.actionIconBtn, styles.deleteBtn].join(" ")}
                                        aria-label={`Удалить сессию ${session.title}`}
                                        title="Удалить из списка"
                                        onClick={() => onDeleteSession(session.sessionId)}
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            <div className={styles.footer}>
                <button
                    type="button"
                    className={styles.themeToggleBtn}
                    aria-label="Переключить тему"
                    title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
                    onClick={onToggleTheme}
                >
                    {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
                    <span>{theme === "dark" ? "Светлая тема" : "Тёмная тема"}</span>
                </button>
            </div>
        </aside>
    );
}
