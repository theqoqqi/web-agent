import { ArrowDown } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { ChatMessage, SessionErrorState } from "../acp/session-reducer";
import { pluralize } from "../lib/pluralize";
import { ErrorMessage } from "./ErrorMessage";
import { MessageItem } from "./MessageItem";
import { TypingIndicator } from "./TypingIndicator";
import styles from "./ChatViewport.module.css";

const BOTTOM_STICK_THRESHOLD_PX = 48;
const TOP_LOAD_THRESHOLD_PX = 64;

export interface ChatViewportProps {
    messages: ChatMessage[];
    hiddenCount: number;
    onLoadMore: () => void;
    isLoadingSession: boolean;
    isGenerating: boolean;
    isPending: boolean;
    error: SessionErrorState | null;
    cwd: string;
}

export function ChatViewport({
    messages,
    hiddenCount,
    onLoadMore,
    isLoadingSession,
    isGenerating,
    isPending,
    error,
    cwd,
}: ChatViewportProps) {
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const autoScrollRef = useRef(true);
    const pendingCompensationRef = useRef<{
        prevScrollHeight: number;
        prevScrollTop: number;
    } | null>(null);
    const [showScrollDown, setShowScrollDown] = useState(false);

    useLayoutEffect(() => {
        const el = viewportRef.current;

        if (!el) {
            return;
        }

        if (messages.length === 0 && !isLoadingSession) {
            autoScrollRef.current = true;
            pendingCompensationRef.current = null;
            setShowScrollDown(false);
            return;
        }

        const compensation = pendingCompensationRef.current;

        if (compensation) {
            const heightDiff = el.scrollHeight - compensation.prevScrollHeight;
            el.scrollTop = compensation.prevScrollTop + heightDiff;
            pendingCompensationRef.current = null;
            return;
        }

        if (autoScrollRef.current) {
            el.scrollTop = el.scrollHeight;
        }
    }, [messages, hiddenCount, isLoadingSession, isGenerating, isPending, error]);

    function triggerLoadMore() {
        const el = viewportRef.current;

        if (!el || hiddenCount <= 0 || pendingCompensationRef.current) {
            return;
        }

        pendingCompensationRef.current = {
            prevScrollHeight: el.scrollHeight,
            prevScrollTop: el.scrollTop,
        };
        onLoadMore();
    }

    function handleScroll() {
        const el = viewportRef.current;

        if (!el) {
            return;
        }

        const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        const nearBottom = distanceToBottom <= BOTTOM_STICK_THRESHOLD_PX;

        if (nearBottom !== autoScrollRef.current) {
            autoScrollRef.current = nearBottom;
            setShowScrollDown(!nearBottom);
        }

        if (el.scrollTop <= TOP_LOAD_THRESHOLD_PX && hiddenCount > 0) {
            triggerLoadMore();
        }
    }

    function handleScrollToBottom() {
        const el = viewportRef.current;
        autoScrollRef.current = true;
        setShowScrollDown(false);

        if (el) {
            el.scrollTop = el.scrollHeight;
        }
    }

    const lastMessageId = messages[messages.length - 1]?.id ?? null;

    return (
        <div className={styles.wrapper}>
            <main
                ref={viewportRef}
                className={styles.viewport}
                role="log"
                aria-live="polite"
                onScroll={handleScroll}
            >
                <div className={styles.inner}>
                    {hiddenCount > 0 && (
                        <div className={styles.historyBar}>
                            <button
                                type="button"
                                className={styles.historyBtn}
                                onClick={triggerLoadMore}
                            >
                                Показать ранние сообщения (скрыто {pluralize(hiddenCount, ["сообщение", "сообщения", "сообщений"])})
                            </button>
                        </div>
                    )}

                    {isLoadingSession && messages.length === 0 ? (
                        <div className={styles.emptyState}>
                            <p className={styles.emptyTitle}>Загружаю историю сессии...</p>
                        </div>
                    ) : messages.length === 0 ? (
                        <div className={styles.emptyState}>
                            <p className={styles.emptyTitle}>Начни диалог с агентом</p>
                            <p className={styles.emptyHint}>Рабочий каталог: {cwd}</p>
                        </div>
                    ) : (
                        messages.map((message) => (
                            <MessageItem
                                key={message.id}
                                message={message}
                                isGenerating={isGenerating && message.id === lastMessageId}
                                cwd={cwd}
                            />
                        ))
                    )}

                    {isPending && <TypingIndicator />}

                    {error && (
                        <ErrorMessage
                            message={error.message}
                            isAuthError={error.isAuthError}
                        />
                    )}
                </div>
            </main>

            {showScrollDown && (
                <button
                    type="button"
                    className={styles.scrollDownBtn}
                    onClick={handleScrollToBottom}
                >
                    <ArrowDown size={14} />
                    <span>Вниз</span>
                </button>
            )}
        </div>
    );
}
