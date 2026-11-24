import { Check, Copy } from "lucide-react";
import { memo, useState } from "react";
import type { ChatMessage, MessageBlock } from "../acp/session-reducer";
import { copyText } from "../lib/clipboard";
import { AgentSteps } from "./AgentSteps";
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
    const isUser = message.role === "user";
    const copyableText = getCopyableText(message.blocks);
    const hasCopyableText = copyableText.length > 0;

    async function handleCopyMessage() {
        if (!copyableText) {
            return;
        }

        const ok = await copyText(copyableText);

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
                    <div>{getPlainText(message.blocks)}</div>
                ) : (
                    message.blocks.map((block) =>
                        block.kind === "steps" ? (
                            <AgentSteps
                                key={block.id}
                                items={block.items}
                                isGenerating={isGenerating}
                                cwd={cwd}
                            />
                        ) : (
                            <MarkdownView
                                key={block.id}
                                content={block.text}
                                cwd={cwd}
                            />
                        ),
                    )
                )}
            </div>

            {hasCopyableText && (
                <div className={styles.actions}>
                    <button
                        type="button"
                        aria-label="Копировать сообщение"
                        title={copied ? "Скопировано" : "Копировать"}
                        className={styles.copyBtn}
                        onClick={() => void handleCopyMessage()}
                    >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                </div>
            )}
        </div>
    );
});

function getPlainText(blocks: MessageBlock[]): string {
    return blocks
        .filter((block): block is Extract<MessageBlock, { kind: "text" }> => block.kind === "text")
        .map((block) => block.text)
        .join("\n\n");
}

function getCopyableText(blocks: MessageBlock[]): string {
    const text = getPlainText(blocks);

    if (text.length > 0) {
        return text;
    }

    return blocks
        .flatMap((block) => (block.kind === "steps" ? block.items : []))
        .filter((item) => item.kind === "thought")
        .map((item) => item.text)
        .join("\n\n");
}
