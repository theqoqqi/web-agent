const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const SAFE_IMAGE_PROTOCOLS = new Set(["http:", "https:"]);

export function buildFileViewerUrl(
    targetPath: string,
    hash?: string,
): string {
    let url = `/files?path=${encodeURIComponent(targetPath)}`;

    if (hash && hash.length > 0) {
        const normalizedHash = hash.startsWith("#") ? hash : `#${hash}`;
        url += normalizedHash;
    }

    return url;
}

export function convertFileUriToViewerUrl(
    rawUri: string,
    cwd?: string,
): string | null {
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

    return buildFileViewerUrl(resolvedPath, hash);
}

export function resolveLocationToViewerUrl(
    rawPath: string,
    line?: number,
    cwd?: string,
): string | null {
    const cleaned = rawPath.trim().replace(/^📁\s*/, "").trim();

    if (cleaned.length === 0) {
        return null;
    }

    if (/^file:/i.test(cleaned)) {
        const converted = convertFileUriToViewerUrl(cleaned, cwd);

        if (converted && line !== undefined && !converted.includes("#")) {
            return `${converted}#L${line}`;
        }

        return converted;
    }

    const split = splitPathAndLineHash(cleaned);
    const resolvedPath = resolvePossiblyRelativePath(split.filePath, cwd);

    if (!resolvedPath) {
        return null;
    }

    const hash = split.hash || (line !== undefined ? `#L${line}` : "");
    return buildFileViewerUrl(resolvedPath, hash);
}

export function sanitizeHref(
    rawHref: string,
    cwd?: string,
): string {
    const trimmed = rawHref.trim();

    if (trimmed.length === 0) {
        return "#";
    }

    if (/^file:/i.test(trimmed)) {
        return convertFileUriToViewerUrl(trimmed, cwd) ?? "#";
    }

    if (trimmed.startsWith("#") || (trimmed.startsWith("/") && !trimmed.startsWith("//"))) {
        return trimmed;
    }

    try {
        const parsed = new URL(trimmed);

        if (SAFE_LINK_PROTOCOLS.has(parsed.protocol)) {
            return trimmed;
        }
    } catch {
        return "#";
    }

    return "#";
}

export function sanitizeImageHref(rawHref: string): string {
    const trimmed = rawHref.trim();

    if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
        return trimmed;
    }

    try {
        const parsed = new URL(trimmed);

        if (SAFE_IMAGE_PROTOCOLS.has(parsed.protocol)) {
            return trimmed;
        }
    } catch {
        return "";
    }

    return "";
}

function extractFileUriPath(
    withoutHash: string,
    cwd?: string,
): string | null {
    const afterScheme = withoutHash.slice(5);

    if (afterScheme.startsWith("///")) {
        return normalizeWindowsDrivePath(decodeSafe(afterScheme.slice(2)));
    }

    if (/^\/\/localhost\//i.test(afterScheme)) {
        return normalizeWindowsDrivePath(decodeSafe(afterScheme.slice(11)));
    }

    const relativeRaw = afterScheme.startsWith("//")
        ? afterScheme.slice(2)
        : afterScheme;
    return resolvePossiblyRelativePath(decodeSafe(relativeRaw), cwd);
}

function normalizeWindowsDrivePath(rawPath: string): string {
    if (/^\/[A-Za-z]:\//.test(rawPath)) {
        return rawPath.slice(1);
    }

    return rawPath;
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
            ? lineMatch[2]
                  .split("-")
                  .map((num) => `L${num}`)
                  .join("-")
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

function resolvePossiblyRelativePath(
    inputPath: string,
    cwd?: string,
): string | null {
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

    const base = cwd.trim().replace(/\/+$/, "");
    return `${base}/${trimmed.replace(/^\.\//, "")}`;
}

function decodeSafe(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}
