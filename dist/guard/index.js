// ============================================================================
// Trash — the half of `backupEnabled` / `deletionProtection` that was missing.
//
// Both switches existed in the schema and did nothing: nothing copied a file
// before a tool wrote or deleted it. This module does exactly that, and nothing
// else — it is not a git replacement, just a last-resort copy so a bad `write`
// or `remove` is not final.
//
// Rules:
//   - only regular files, only under the size cap, only when the switch is on
//   - a failure here is ignored by the caller (fail-open)
//   - the copy keeps the original extension so it can be opened as-is
// ============================================================================
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
/** 文件名冲突时用的短哈希（只依赖字符串，避免引入 crypto）。 */
function shortName(value) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}
/** `C:\work\a.txt` → `C_work_a.txt`，保留扩展名便于直接打开。 */
export function flattenPath(value) {
    const normalized = String(value).replace(/^[a-zA-Z]:/, (drive) => drive[0]).replace(/[\\/]+/g, '_').replace(/^_+/, '');
    const safe = normalized.replace(/[<>:"|?*]/g, '_').slice(-120);
    return safe || `file-${shortName(String(value))}`;
}
/**
 * 在工具执行前把会被改动/删除的文件复制到 `<stateDir>/trash/<stamp>/`。
 *
 * 复制失败不抛错：调用方只关心"有没有尽力保住一份"。
 */
export async function snapshotPaths(paths, options) {
    const dir = options.stateDir ? join(options.stateDir, 'trash', options.stamp) : null;
    if (!options.enabled || !dir)
        return { saved: 0, skipped: 0, dir };
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    let saved = 0;
    let skipped = 0;
    const seen = new Set();
    for (const target of paths) {
        const abs = String(target ?? '');
        if (!abs || seen.has(abs))
            continue;
        seen.add(abs);
        let info;
        try {
            info = await stat(abs);
        }
        catch {
            continue; // 文件不存在：没有东西可备份（新文件）
        }
        if (!info.isFile())
            continue;
        if (info.size > maxBytes) {
            skipped += 1;
            continue;
        }
        try {
            await mkdir(dir, { recursive: true });
            const name = flattenPath(abs);
            await copyFile(abs, join(dir, name));
            await recordIndex(dir, { file: name, original: abs, bytes: info.size, at: new Date().toISOString() });
            saved += 1;
        }
        catch {
            skipped += 1; // 权限/占用：不阻断调用
        }
    }
    return { saved, skipped, dir: saved ? dir : null };
}
/** 回收站当前占用：文件数、字节数、时间戳目录数。 */
export async function trashUsage(stateDir) {
    const dir = stateDir ? join(stateDir, 'trash') : null;
    if (!dir)
        return { dir, files: 0, bytes: 0, stamps: 0 };
    let entries = [];
    try {
        entries = await readdir(dir);
    }
    catch {
        return { dir, files: 0, bytes: 0, stamps: 0 };
    }
    let files = 0;
    let bytes = 0;
    for (const stamp of entries) {
        let listed = [];
        try {
            listed = await readdir(join(dir, stamp), { recursive: true, withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of listed) {
            if (!entry.isFile() || entry.name === INDEX_NAME)
                continue;
            files += 1;
            try {
                bytes += (await stat(join(entry.parentPath ?? entry.path, entry.name))).size;
            }
            catch {
                /* 文件刚被删：跳过 */
            }
        }
    }
    return { dir, files, bytes, stamps: entries.length };
}
/**
 * 按时间与总量清理回收站。
 *
 * 两轮：先删超过保留天数的，再按目录从旧到新删到总量低于上限。
 * 任何一步失败都继续，最后返回真实删掉了多少。
 */
export async function pruneTrash(stateDir, options = {}) {
    const dir = stateDir ? join(stateDir, 'trash') : undefined;
    if (!dir)
        return { removed: 0, bytes: 0, kept: 0 };
    let stamps = [];
    try {
        stamps = (await readdir(dir)).sort();
    }
    catch {
        return { removed: 0, bytes: 0, kept: 0 };
    }
    const retentionDays = Number(options.retentionDays);
    const cutoff = Number.isFinite(retentionDays) && retentionDays > 0 ? Date.now() - retentionDays * 86400_000 : undefined;
    const maxBytes = Number(options.maxMB) > 0 ? Number(options.maxMB) * 1024 * 1024 : undefined;
    const sizes = new Map();
    const removedDirs = new Set();
    let removed = 0;
    let freed = 0;
    for (const stamp of stamps) {
        const full = join(dir, stamp);
        let info;
        try {
            info = await stat(full);
        }
        catch {
            continue;
        }
        const size = (await trashUsageOf(full)).bytes;
        sizes.set(stamp, size);
        if (cutoff && info.mtimeMs < cutoff) {
            try {
                await rm(full, { recursive: true, force: true });
                removedDirs.add(stamp);
                removed += 1;
                freed += size;
            }
            catch {
                /* 占用中：下轮再删 */
            }
        }
    }
    if (maxBytes) {
        let total = [...sizes.entries()].filter(([stamp]) => !removedDirs.has(stamp)).reduce((sum, [, size]) => sum + size, 0);
        for (const stamp of stamps) {
            if (total <= maxBytes)
                break;
            if (removedDirs.has(stamp))
                continue;
            try {
                await rm(join(dir, stamp), { recursive: true, force: true });
                removed += 1;
                const size = sizes.get(stamp) ?? 0;
                total -= size;
                freed += size;
            }
            catch {
                /* 跳过 */
            }
        }
    }
    return { removed, bytes: freed, kept: stamps.length - removed };
}
async function trashUsageOf(dir) {
    let files = 0;
    let bytes = 0;
    let listed = [];
    try {
        listed = await readdir(dir, { recursive: true, withFileTypes: true });
    }
    catch {
        return { files, bytes };
    }
    for (const entry of listed) {
        if (!entry.isFile() || entry.name === INDEX_NAME)
            continue;
        files += 1;
        try {
            bytes += (await stat(join(entry.parentPath ?? entry.path, entry.name))).size;
        }
        catch {
            /* 忽略 */
        }
    }
    return { files, bytes };
}
/** 每个时间戳目录一份索引，记录副本来自哪个原路径——恢复靠它。 */
const INDEX_NAME = '.index.json';
async function readIndex(dir) {
    try {
        const raw = JSON.parse(await readFile(join(dir, INDEX_NAME), 'utf8'));
        return Array.isArray(raw?.entries) ? raw.entries : [];
    }
    catch {
        return [];
    }
}
async function recordIndex(dir, entry) {
    try {
        const entries = await readIndex(dir);
        const next = entries.filter((item) => item.file !== entry.file);
        next.push(entry);
        await writeFile(join(dir, INDEX_NAME), JSON.stringify({ entries: next }, null, 2), 'utf8');
    }
    catch {
        /* 索引失败不影响副本本身 */
    }
}
/** 最近的副本（新的在前）。旧版本留下的目录没有索引，会被跳过。 */
export async function listTrash(stateDir, limit = 20) {
    const dir = stateDir ? join(stateDir, 'trash') : undefined;
    if (!dir)
        return [];
    let stamps = [];
    try {
        stamps = (await readdir(dir)).sort().reverse();
    }
    catch {
        return [];
    }
    const out = [];
    for (const stamp of stamps) {
        const entries = await readIndex(join(dir, stamp));
        for (const entry of entries) {
            out.push({ ...entry, stamp, path: join(dir, stamp, entry.file) });
            if (out.length >= limit)
                return out;
        }
    }
    return out;
}
/**
 * 把一份副本放回原路径。
 *
 * 默认不覆盖：目标已存在就返回 conflict，由调用方决定是否再来一次。
 * 直接覆盖会把"现在的版本"冲掉，那正是这个功能要防的事。
 */
export async function restoreTrash(stateDir, stamp, file, options = {}) {
    if (!stateDir)
        return { status: 'missing' };
    const dir = join(stateDir, 'trash', stamp);
    const entries = await readIndex(dir);
    const entry = entries.find((item) => item.file === file);
    if (!entry)
        return { status: 'missing' };
    const source = join(dir, entry.file);
    try {
        await stat(source);
    }
    catch {
        return { status: 'missing' };
    }
    if (!options.overwrite) {
        try {
            await stat(entry.original);
            return { status: 'conflict', target: entry.original };
        }
        catch {
            /* 不存在：可以直接恢复 */
        }
    }
    try {
        await mkdir(dirname(entry.original), { recursive: true });
        await copyFile(source, entry.original);
        return { status: 'restored', target: entry.original };
    }
    catch {
        return { status: 'missing', target: entry.original };
    }
}
/** 一次调用的时间戳目录名。 */
export function trashStamp(now = new Date()) {
    return now.toISOString().replace(/[:.]/g, '-');
}
