import type { Stats } from "node:fs";
import { open, readdir, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FileViewMode } from "./path-utils.js";

const BINARY_PROBE_BYTES = 8192;

export interface FileReaderOptions {
    maxFileBytes: number;
    snippetBytes: number;
}

export interface DirectoryEntry {
    name: string;
    fullPath: string;
    entryType: "directory" | "file" | "broken";
    size: number | null;
}

export interface FileSnippetInfo {
    edge: "head" | "tail";
    byteStart: number;
    byteEnd: number;
    totalBytes: number;
}

export type FileReadResult =
    | {
          kind: "directory";
          resolvedPath: string;
          entries: DirectoryEntry[];
      }
    | {
          kind: "text";
          resolvedPath: string;
          size: number;
          content: string;
          snippet?: FileSnippetInfo;
      }
    | {
          kind: "too_large";
          resolvedPath: string;
          size: number;
          maxFileBytes: number;
      }
    | {
          kind: "binary";
          resolvedPath: string;
          size: number;
      }
    | {
          kind: "download";
          resolvedPath: string;
          size: number;
      };

export class FileViewerError extends Error {
    public readonly statusCode: number;

    public constructor(statusCode: number, message: string) {
        super(message);
        this.name = "FileViewerError";
        this.statusCode = statusCode;
    }
}

export async function readFileTarget(
    targetPath: string,
    mode: FileViewMode,
    options: FileReaderOptions,
): Promise<FileReadResult> {
    const resolvedPath = await resolveRealPath(targetPath);
    const stats = await readStatSafe(resolvedPath);

    if (stats.isDirectory()) {
        if (mode === "download") {
            throw new FileViewerError(400, "Cannot download a directory");
        }
        const entries = await readDirectoryEntries(resolvedPath);
        return {
            kind: "directory",
            resolvedPath,
            entries,
        };
    }

    if (!stats.isFile()) {
        throw new FileViewerError(400, "Target path is not a regular file or directory");
    }

    if (mode === "download") {
        return {
            kind: "download",
            resolvedPath,
            size: stats.size,
        };
    }

    if (mode === "head" || mode === "tail") {
        return readSnippetTarget(resolvedPath, stats.size, mode, options.snippetBytes);
    }

    if (stats.size > options.maxFileBytes) {
        return {
            kind: "too_large",
            resolvedPath,
            size: stats.size,
            maxFileBytes: options.maxFileBytes,
        };
    }

    return readFullTextTarget(resolvedPath, stats.size);
}

async function resolveRealPath(targetPath: string): Promise<string> {
    try {
        return await realpath(targetPath);
    } catch (error) {
        throw mapFsError(error, targetPath);
    }
}

async function readStatSafe(resolvedPath: string): Promise<Stats> {
    try {
        return await stat(resolvedPath);
    } catch (error) {
        throw mapFsError(error, resolvedPath);
    }
}

async function readDirectoryEntries(dirPath: string): Promise<DirectoryEntry[]> {
    let names: string[];
    try {
        names = await readdir(dirPath);
    } catch (error) {
        throw mapFsError(error, dirPath);
    }

    const entries = await Promise.all(
        names.map(async (name): Promise<DirectoryEntry> => {
            const fullPath = join(dirPath, name);
            try {
                const entryStats = await stat(fullPath);
                if (entryStats.isDirectory()) {
                    return {
                        name,
                        fullPath,
                        entryType: "directory",
                        size: null,
                    };
                }
                if (entryStats.isFile()) {
                    return {
                        name,
                        fullPath,
                        entryType: "file",
                        size: entryStats.size,
                    };
                }
                return {
                    name,
                    fullPath,
                    entryType: "broken",
                    size: null,
                };
            } catch {
                return {
                    name,
                    fullPath,
                    entryType: "broken",
                    size: null,
                };
            }
        }),
    );

    return entries.sort(compareDirectoryEntries);
}

async function readFullTextTarget(resolvedPath: string, totalBytes: number): Promise<FileReadResult> {
    const buffer = await readByteRange(resolvedPath, 0, totalBytes);
    if (isBinaryBuffer(buffer)) {
        return {
            kind: "binary",
            resolvedPath,
            size: totalBytes,
        };
    }

    return {
        kind: "text",
        resolvedPath,
        size: totalBytes,
        content: buffer.toString("utf8"),
    };
}

async function readSnippetTarget(
    resolvedPath: string,
    totalBytes: number,
    edge: "head" | "tail",
    snippetBytes: number,
): Promise<FileReadResult> {
    const probeLength = Math.min(totalBytes, BINARY_PROBE_BYTES);
    const probe = await readByteRange(resolvedPath, 0, probeLength);
    if (isBinaryBuffer(probe)) {
        return {
            kind: "binary",
            resolvedPath,
            size: totalBytes,
        };
    }

    const length = Math.min(totalBytes, snippetBytes);
    const startOffset = edge === "head" ? 0 : Math.max(0, totalBytes - length);
    const rawSlice = await readByteRange(resolvedPath, startOffset, length);
    if (isBinaryBuffer(rawSlice)) {
        return {
            kind: "binary",
            resolvedPath,
            size: totalBytes,
        };
    }

    const trimStart = startOffset > 0 ? countLeadingContinuationBytes(rawSlice) : 0;
    const endOffset = startOffset + rawSlice.length;
    const trimEnd = endOffset < totalBytes
        ? rawSlice.length - countTrailingIncompleteUtf8Bytes(rawSlice)
        : rawSlice.length;

    const safeSlice = trimEnd > trimStart ? rawSlice.subarray(trimStart, trimEnd) : Buffer.alloc(0);

    return {
        kind: "text",
        resolvedPath,
        size: totalBytes,
        content: safeSlice.toString("utf8"),
        snippet: {
            edge,
            byteStart: startOffset + trimStart,
            byteEnd: startOffset + trimEnd,
            totalBytes,
        },
    };
}

async function readByteRange(filePath: string, offset: number, length: number): Promise<Buffer> {
    if (length === 0) {
        return Buffer.alloc(0);
    }

    const handle = await open(filePath, "r");
    try {
        const buffer = Buffer.alloc(length);
        let totalRead = 0;
        while (totalRead < length) {
            const { bytesRead } = await handle.read(buffer, totalRead, length - totalRead, offset + totalRead);
            if (bytesRead === 0) {
                break;
            }
            totalRead += bytesRead;
        }
        return buffer.subarray(0, totalRead);
    } finally {
        await handle.close();
    }
}

function isBinaryBuffer(buffer: Buffer): boolean {
    const inspectLength = Math.min(buffer.length, BINARY_PROBE_BYTES);
    return buffer.subarray(0, inspectLength).includes(0);
}

function countLeadingContinuationBytes(buffer: Buffer): number {
    let index = 0;
    while (index < buffer.length && index < 3) {
        const byte = buffer[index];
        if (byte === undefined || (byte & 0xc0) !== 0x80) {
            break;
        }
        index++;
    }
    return index;
}

function countTrailingIncompleteUtf8Bytes(buffer: Buffer): number {
    if (buffer.length === 0) {
        return 0;
    }

    let checkStart = buffer.length - 1;
    const minIndex = Math.max(0, buffer.length - 4);
    while (checkStart > minIndex) {
        const b = buffer[checkStart];
        if (b !== undefined && (b & 0xc0) !== 0x80) {
            break;
        }
        checkStart--;
    }

    const lead = buffer[checkStart];
    if (lead === undefined || lead < 0x80) {
        return 0;
    }

    let expectedLength = 1;
    if ((lead & 0xe0) === 0xc0) {
        expectedLength = 2;
    } else if ((lead & 0xf0) === 0xe0) {
        expectedLength = 3;
    } else if ((lead & 0xf8) === 0xf0) {
        expectedLength = 4;
    }

    const actualLength = buffer.length - checkStart;
    return actualLength < expectedLength ? actualLength : 0;
}

function compareDirectoryEntries(a: DirectoryEntry, b: DirectoryEntry): number {
    const rankA = a.entryType === "directory" ? 0 : 1;
    const rankB = b.entryType === "directory" ? 0 : 1;
    if (rankA !== rankB) {
        return rankA - rankB;
    }
    if (a.name < b.name) {
        return -1;
    }
    if (a.name > b.name) {
        return 1;
    }
    return 0;
}

function mapFsError(error: unknown, targetPath: string): FileViewerError {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") {
        return new FileViewerError(404, `Path not found: ${targetPath}`);
    }
    if (code === "EACCES" || code === "EPERM") {
        return new FileViewerError(403, `Permission denied: ${targetPath}`);
    }
    const message = error instanceof Error ? error.message : String(error);
    return new FileViewerError(500, `Failed to read path ${targetPath}: ${message}`);
}
