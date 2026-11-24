import { FolderInput, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { StoredSession } from "../lib/storage";
import styles from "./SessionSidebar.module.css";

export interface SessionSidebarProps {
    sessions: StoredSession[];
    activeSessionId: string | null;
    cwd: string;
    canLoadSession: boolean;
    isConnected: boolean;
    onChangeCwd: (cwd: string) => void;
    onNewSession: () => void;
    onSelectSession: (session: StoredSession) => void;
    onDeleteSession: (sessionId: string) => void;
    onOpenSessionById: (sessionId: string) => Promise<boolean>;
}

export function SessionSidebar({
    sessions,
    activeSessionId,
    cwd,
    canLoadSession,
    isConnected,
    onChangeCwd,
    onNewSession,
    onSelectSession,
    onDeleteSession,
    onOpenSessionById,
}: SessionSidebarProps) {
    const [isImportOpen, setIsImportOpen] = useState(false);
    const [importId, setImportId] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

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

                                <button
                                    type="button"
                                    className={styles.deleteBtn}
                                    aria-label={`Удалить сессию ${session.title}`}
                                    title="Удалить из списка"
                                    onClick={() => onDeleteSession(session.sessionId)}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        );
                    })
                )}
            </div>
        </aside>
    );
}
