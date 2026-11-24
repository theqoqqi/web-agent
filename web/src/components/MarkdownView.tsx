import { useMemo, type MouseEvent } from "react";
import { copyText } from "../lib/clipboard";
import { renderMarkdown } from "../lib/markdown";
import styles from "./MarkdownView.module.css";

export interface MarkdownViewProps {
    content: string;
    cwd: string;
}

export function MarkdownView({ content, cwd }: MarkdownViewProps) {
    const html = useMemo(() => renderMarkdown(content, { cwd }), [content, cwd]);

    function handleClick(event: MouseEvent<HTMLDivElement>) {
        const target = event.target;

        if (!(target instanceof HTMLElement)) {
            return;
        }

        const copyBtn = target.closest(".md-copy-code-btn");

        if (!(copyBtn instanceof HTMLButtonElement)) {
            return;
        }

        const block = copyBtn.closest(".md-code-block");
        const code = block?.querySelector("pre code")?.textContent ?? "";

        void copyCodeWithFeedback(copyBtn, code);
    }

    return (
        <div
            className={styles.content}
            onClick={handleClick}
            dangerouslySetInnerHTML={{ __html: html }}
        />
    );
}

async function copyCodeWithFeedback(
    button: HTMLButtonElement,
    code: string,
): Promise<void> {
    const ok = await copyText(code);

    if (!ok) {
        return;
    }

    button.textContent = "Скопировано";
    setTimeout(() => {
        if (button.isConnected) {
            button.textContent = "Копировать";
        }
    }, 1500);
}
