import { posix, resolve } from "node:path";

export type FileViewMode = "view" | "raw" | "download" | "head" | "tail";

export interface FileViewerQuery {
    targetPath: string;
    mode: FileViewMode;
}

export interface BuildFileViewerUrlOptions {
    mode?: FileViewMode;
    hash?: string;
}

export interface BreadcrumbItem {
    label: string;
    url: string;
}

export function parseFileViewerQuery(rawUrl: string, defaultCwd: string): FileViewerQuery {
    const parsedUrl = new URL(rawUrl, "http://127.0.0.1");
    const rawPathParam = parsedUrl.searchParams.get("path");

    let targetPath: string;
    if (rawPathParam === null) {
        targetPath = defaultCwd;
    } else {
        const trimmed = rawPathParam.trim();
        if (trimmed.length === 0) {
            throw new Error("Invalid empty path parameter");
        }
        if (trimmed.includes("\0")) {
            throw new Error("Invalid path containing NUL byte");
        }
        targetPath = resolve(defaultCwd, trimmed);
    }

    const mode = parseViewMode(parsedUrl.searchParams);
    return {
        targetPath,
        mode,
    };
}

export function buildFileViewerUrl(
    targetPath: string,
    options: BuildFileViewerUrlOptions = {},
): string {
    const mode = options.mode ?? "view";
    let url = `/files?path=${encodeURIComponent(targetPath)}`;
    if (mode !== "view") {
        url += `&${mode}=1`;
    }
    if (options.hash && options.hash.length > 0) {
        const normalizedHash = options.hash.startsWith("#") ? options.hash : `#${options.hash}`;
        url += normalizedHash;
    }
    return url;
}

export function convertFileUriToViewerUrl(rawUri: string, cwd?: string): string | null {
    const trimmed = rawUri.trim();
    if (!/^file:/i.test(trimmed)) {
        return null;
    }

    const hashIndex = trimmed.indexOf("#");
    const withoutHash = hashIndex === -1 ? trimmed : trimmed.slice(0, hashIndex);
    const hash = hashIndex === -1 ? "" : trimmed.slice(hashIndex);

    const resolvedPath = extractFileUriPath(withoutHash, cwd);
    if (!resolvedPath) {
        return null;
    }

    return buildFileViewerUrl(resolvedPath, {
        hash,
    });
}

export function resolveLocationPathToViewerUrl(
    rawTextPath: string,
    cwd?: string,
): string | null {
    const cleaned = rawTextPath.trim().replace(/^📁\s*/, "").trim();
    if (cleaned.length === 0) {
        return null;
    }

    const split = splitPathAndLineHash(cleaned);
    const resolvedPath = resolvePossiblyRelativePath(split.filePath, cwd);
    if (!resolvedPath) {
        return null;
    }

    return buildFileViewerUrl(resolvedPath, {
        hash: split.hash,
    });
}

export function buildBreadcrumbs(targetPath: string): BreadcrumbItem[] {
    if (targetPath.startsWith("/")) {
        const normalized = posix.normalize(targetPath);
        const parts = normalized.split("/").filter(Boolean);
        const crumbs: BreadcrumbItem[] = [
            {
                label: "/",
                url: buildFileViewerUrl("/"),
            },
        ];

        let acc = "";
        for (const part of parts) {
            acc += `/${part}`;
            crumbs.push({
                label: part,
                url: buildFileViewerUrl(acc),
            });
        }
        return crumbs;
    }

    const windowsDriveMatch = /^[A-Za-z]:[\\/]/.exec(targetPath);
    if (windowsDriveMatch) {
        const root = `${targetPath.slice(0, 2)}\\`;
        const rest = targetPath.slice(3).split(/[\\/]+/).filter(Boolean);
        const crumbs: BreadcrumbItem[] = [
            {
                label: root,
                url: buildFileViewerUrl(root),
            },
        ];

        let acc = root.slice(0, 2);
        for (const part of rest) {
            acc = `${acc}\\${part}`;
            crumbs.push({
                label: part,
                url: buildFileViewerUrl(acc),
            });
        }
        return crumbs;
    }

    return [
        {
            label: targetPath,
            url: buildFileViewerUrl(targetPath),
        },
    ];
}

export function buildContentDisposition(filePath: string): string {
    const rawName = filePath.split(/[\\/]/).pop() ?? "file";
    const cleanName = rawName.replace(/[\r\n\0]+/g, "").trim() || "file";
    const asciiFallback = cleanName.replace(/[^A-Za-z0-9._-]/g, "_");
    const encodedUtf8 = encodeRfc5987Value(cleanName);
    return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedUtf8}`;
}

function parseViewMode(params: URLSearchParams): FileViewMode {
    if (isTruthyParam(params.get("download"))) {
        return "download";
    }
    if (isTruthyParam(params.get("raw"))) {
        return "raw";
    }
    if (isTruthyParam(params.get("head"))) {
        return "head";
    }
    if (isTruthyParam(params.get("tail"))) {
        return "tail";
    }
    return "view";
}

function isTruthyParam(value: string | null): boolean {
    return value === "1" || value === "true";
}

function extractFileUriPath(withoutHash: string, cwd?: string): string | null {
    const afterScheme = withoutHash.slice(5);
    let rawPath: string;

    if (afterScheme.startsWith("///")) {
        rawPath = decodeSafe(afterScheme.slice(2));
        if (/^\/[A-Za-z]:\//.test(rawPath)) {
            rawPath = rawPath.slice(1);
        }
        return rawPath;
    }

    if (/^\/\/localhost\//i.test(afterScheme)) {
        rawPath = decodeSafe(afterScheme.slice(11));
        if (/^\/[A-Za-z]:\//.test(rawPath)) {
            rawPath = rawPath.slice(1);
        }
        return rawPath;
    }

    const relativeRaw = afterScheme.startsWith("//") ? afterScheme.slice(2) : afterScheme;
    const decodedRel = decodeSafe(relativeRaw);
    return resolvePossiblyRelativePath(decodedRel, cwd);
}

function splitPathAndLineHash(input: string): {
    filePath: string;
    hash: string;
} {
    const hashIndex = input.indexOf("#");
    if (hashIndex !== -1) {
        return {
            filePath: input.slice(0, hashIndex),
            hash: input.slice(hashIndex),
        };
    }

    const lineMatch = /^(.*):(\d+(?:-\d+)?)$/.exec(input);
    if (lineMatch && lineMatch[1] && lineMatch[2]) {
        const range = lineMatch[2].includes("-")
            ? lineMatch[2].split("-").map((n) => `L${n}`).join("-")
            : `L${lineMatch[2]}`;
        return {
            filePath: lineMatch[1],
            hash: `#${range}`,
        };
    }

    return {
        filePath: input,
        hash: "",
    };
}

function resolvePossiblyRelativePath(inputPath: string, cwd?: string): string | null {
    const trimmed = inputPath.trim();
    if (trimmed.length === 0) {
        return null;
    }
    if (trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed)) {
        return trimmed;
    }
    if (!cwd || cwd.trim().length === 0) {
        return null;
    }
    const base = cwd.replace(/\/+$/, "");
    return `${base}/${trimmed.replace(/^\.\//, "")}`;
}

function decodeSafe(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function encodeRfc5987Value(value: string): string {
    return encodeURIComponent(value).replace(
        /['()*!]/g,
        (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
    );
}
