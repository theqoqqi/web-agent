export async function copyText(text: string): Promise<boolean> {
    const clipboardApi = navigator.clipboard;

    if (clipboardApi && typeof clipboardApi.writeText === "function") {
        try {
            await clipboardApi.writeText(text);
            return true;
        } catch {
            return copyWithExecCommand(text);
        }
    }

    return copyWithExecCommand(text);
}

function copyWithExecCommand(text: string): boolean {
    if (typeof document.execCommand !== "function" || !document.body) {
        return false;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);

    try {
        textarea.focus();
        textarea.select();
        return document.execCommand("copy");
    } catch {
        return false;
    } finally {
        textarea.remove();
    }
}
