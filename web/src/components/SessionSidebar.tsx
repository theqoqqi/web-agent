import { Plus, Trash2 } from "lucide-react";
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
}: SessionSidebarProps) {
    return (
        <aside className={styles.sidebar} aria-label="Список сессий">
            <div className={styles.top}>
                <button
                    type="button"
                    className={styles.newChatBtn}
                    disabled={!isConnected}
                    onClick={onNewSession}
                >
                    <Plus size={16} />
                    <span>Новый чат</span>
                </button>

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
