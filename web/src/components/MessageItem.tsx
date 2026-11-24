import { Check, Copy } from "lucide-react";
import { memo, useState } from "react";
import type { ChatMessage } from "../acp/session-reducer";
import { copyText } from "../lib/clipboard";
import { AgentSteps } from "./AgentSteps";
import { Collapsible } from "./Collapsible";
import { MarkdownView } from "./MarkdownView";
import styles from "./MessageItem.module.css";

export interface MessageItemProps {
    message: ChatMessage;
    isGenerating: boolean;
    cwd: string;
}

export const MessageItem = memo(function MessageItem({
    message,
    isGenerating,
    cwd,
}: MessageItemProps) {
    const [copied, setCopied] = useState(false);
    const [thoughtManualOpen, setThoughtManualOpen] = useState<boolean | null>(null);
    const isUser = message.role === "user";
    const hasText = message.content.length > 0;
    const autoOpenSteps = isGenerating && !hasText;
    const isThoughtOpen = thoughtManualOpen ?? (isGenerating && !hasText && message.toolCalls.length === 0);

    async function handleCopyMessage() {
        const textToCopy = message.content || message.thought;

        if (!textToCopy) {
            return;
        }

        const ok = await copyText(textToCopy);

        if (!ok) {
            return;
        }

        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    }

    return (
        <div className={[styles.row, isUser ? styles.userRow : styles.assistantRow].join(" ")}>
            <div
                className={[
                    styles.bubble,
                    isUser ? styles.userBubble : styles.assistantBubble,
                ].join(" ")}
            >
                {isUser ? (
                    <div>{message.content}</div>
                ) : (
                    <>
                        {message.thought.length > 0 && (
                            <Collapsible
                                isOpen={isThoughtOpen}
                                onToggle={() => setThoughtManualOpen(!isThoughtOpen)}
                                header={<span className={styles.thoughtTitle}>Размышления</span>}
                                className={styles.thoughtBox}
                            >
                                <p className={styles.thoughtText}>{message.thought}</p>
                            </Collapsible>
                        )}
                        {message.toolCalls.length > 0 && (
                            <AgentSteps
                                toolCalls={message.toolCalls}
                                autoOpen={autoOpenSteps}
                                cwd={cwd}
                            />
                        )}
                        {hasText && <MarkdownView content={message.content} cwd={cwd} />}
                    </>
                )}

                {hasText && (
                    <div className={styles.actions}>
                        <button
                            type="button"
                            aria-label="Копировать сообщение"
                            className={[styles.copyBtn, isUser ? styles.userCopyBtn : ""].filter(Boolean).join(" ")}
                            onClick={() => void handleCopyMessage()}
                        >
                            {copied ? <Check size={12} /> : <Copy size={12} />}
                            <span>{copied ? "Скопировано" : "Копировать"}</span>
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
});
