import { ArrowUp, Square } from "lucide-react";
import {
    useRef,
    useState,
    type FormEvent,
    type KeyboardEvent,
    type MouseEvent,
} from "react";
import type { AcpAvailableCommand } from "../acp/types";
import styles from "./PromptComposer.module.css";

export interface PromptComposerProps {
    isGenerating: boolean;
    canSend: boolean;
    availableCommands: AcpAvailableCommand[];
    onSend: (text: string) => void;
    onCancel: () => void;
}

export function PromptComposer({
    isGenerating,
    canSend,
    availableCommands,
    onSend,
    onCancel,
}: PromptComposerProps) {
    const [inputValue, setInputValue] = useState("");
    const [activeCommandIndex, setActiveCommandIndex] = useState(0);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    const slashQuery = getSlashQuery(inputValue);
    const filteredCommands =
        slashQuery !== null
            ? availableCommands.filter((cmd) =>
                  cmd.name.toLowerCase().startsWith(slashQuery.toLowerCase()),
              )
            : [];
    const showCommandMenu = filteredCommands.length > 0 && !isGenerating;
    const isSendDisabled = isGenerating || !canSend || inputValue.trim().length === 0;

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        submitCurrentValue();
    }

    function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
        if (showCommandMenu) {
            if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveCommandIndex((prev) => (prev + 1) % filteredCommands.length);
                return;
            }

            if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveCommandIndex(
                    (prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length,
                );
                return;
            }

            if (event.key === "Tab") {
                const chosen = filteredCommands[activeCommandIndex];
                if (chosen) {
                    event.preventDefault();
                    applySlashCommand(chosen);
                }
                return;
            }
        }

        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();

            if (showCommandMenu && filteredCommands[activeCommandIndex]) {
                applySlashCommand(filteredCommands[activeCommandIndex]);
                return;
            }

            submitCurrentValue();
        }
    }

    function applySlashCommand(command: AcpAvailableCommand) {
        setInputValue(`/${command.name} `);
        setActiveCommandIndex(0);
        textareaRef.current?.focus();
    }

    function submitCurrentValue() {
        if (isSendDisabled) {
            return;
        }

        onSend(inputValue.trim());
        setInputValue("");
        setActiveCommandIndex(0);
        textareaRef.current?.focus();
    }

    function handleMouseDownSend(event: MouseEvent<HTMLButtonElement>) {
        event.preventDefault();
    }

    return (
        <footer className={styles.footer}>
            <form className={styles.inner} onSubmit={handleSubmit}>
                {showCommandMenu && (
                    <div className={styles.commandMenu} role="listbox" aria-label="Slash команды">
                        {filteredCommands.map((cmd, index) => (
                            <button
                                key={cmd.name}
                                type="button"
                                className={[
                                    styles.commandOption,
                                    index === activeCommandIndex ? styles.commandOptionActive : "",
                                ]
                                    .filter(Boolean)
                                    .join(" ")}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => applySlashCommand(cmd)}
                            >
                                <span className={styles.commandName}>/{cmd.name}</span>
                                <span className={styles.commandDesc}>{cmd.description}</span>
                            </button>
                        ))}
                    </div>
                )}

                <div className={styles.inputRow}>
                    <div className={styles.inputWrapper}>
                        <textarea
                            ref={textareaRef}
                            className={styles.input}
                            rows={1}
                            placeholder={
                                canSend
                                    ? "Введите сообщение или / для команд..."
                                    : "Ожидание подключения к агенту..."
                            }
                            aria-label="Текст сообщения"
                            value={inputValue}
                            onChange={(event) => {
                                setInputValue(event.currentTarget.value);
                                setActiveCommandIndex(0);
                            }}
                            onKeyDown={handleKeyDown}
                            disabled={isGenerating}
                        />
                    </div>

                    {isGenerating ? (
                        <button
                            type="button"
                            className={styles.sendBtn}
                            title="Остановить генерацию"
                            aria-label="Остановить генерацию"
                            onClick={onCancel}
                        >
                            <Square size={14} fill="currentColor" />
                        </button>
                    ) : (
                        <button
                            type="submit"
                            className={styles.sendBtn}
                            disabled={isSendDisabled}
                            title="Отправить"
                            aria-label="Отправить сообщение"
                            onMouseDown={handleMouseDownSend}
                        >
                            <ArrowUp size={17} />
                        </button>
                    )}
                </div>
            </form>
        </footer>
    );
}

function getSlashQuery(value: string): string | null {
    if (!value.startsWith("/")) {
        return null;
    }

    const spaceIndex = value.indexOf(" ");

    if (spaceIndex !== -1 || value.includes("\n")) {
        return null;
    }

    return value.slice(1);
}
