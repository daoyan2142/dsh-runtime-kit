// ============================================================================
// Dashboard bridge — the Host half of the page.
//
// The plugin's abilities used to be reachable only through `runtime_kit_*`
// slash commands. This module exposes the same data as one JSON endpoint and
// lets the client flip the governance switches without a restart.
//
// Everything here is read-mostly: the only write is `governance`, and it goes
// through the same normalizer the startup path uses, then persists to
// `<stateDir>/governance.json` so a restart keeps the choice.
// ============================================================================
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { normalizeGovernance } from '../hooks/policy.js';
import { governanceStats } from '../hooks/index.js';
import { normalizeWorkspaces, registerWorkspaces, verifyIsolation } from '../workspaces/index.js';
import { listTrash, pruneTrash, restoreTrash, trashUsage } from '../guard/index.js';
const API_PREFIX = '/runtime-kit/api/';
const ALLOWED_KEYS = ['enabled', 'audit', 'redaction', 'injection', 'sandbox', 'truncation', 'projection', 'profile'];
function governancePath(service) {
    const stateDir = service.getConfig?.()?.stateDir;
    return stateDir ? join(stateDir, 'governance.json') : undefined;
}
async function loadSavedGovernance(service) {
    const file = governancePath(service);
    if (!file)
        return;
    try {
        const raw = JSON.parse(await readFile(file, 'utf8'));
        Object.assign(service.governance ?? {}, normalizeGovernance(raw));
    }
    catch {
        /* first run, or a hand-edited file: keep the startup config */
    }
}
async function saveSandbox(service, payload) {
    const file = sandboxPath(service);
    if (!file)
        return;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}
async function loadSavedSandbox(service) {
    const file = sandboxPath(service);
    if (!file)
        return;
    try {
        const raw = JSON.parse(await readFile(file, 'utf8'));
        const { workspaces } = normalizeWorkspaces(raw.workspaces);
        if (!workspaces.length)
            return;
        const current = service.getConfig?.() ?? {};
        service.reloadConfig?.({
            sandbox: {
                ...(current.sandbox ?? {}),
                workspaces,
                ...(raw.commandDefault ? { commandDefault: raw.commandDefault } : {}),
                ...(raw.networkDefault ? { networkDefault: raw.networkDefault } : {}),
            },
        });
        registerWorkspaces(service, workspaces);
    }
    catch {
        /* 文件不存在或坏了：按配置里的来 */
    }
}
function sandboxPath(service) {
    const stateDir = service.getConfig?.()?.stateDir;
    return stateDir ? join(stateDir, 'sandbox.json') : undefined;
}
async function saveGovernance(service, governance) {
    const file = governancePath(service);
    if (!file)
        return;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(governance, null, 2)}\n`, 'utf8');
}
function pickGovernance(input) {
    const out = {};
    for (const key of ALLOWED_KEYS) {
        if (input && Object.prototype.hasOwnProperty.call(input, key))
            out[key] = input[key];
    }
    return out;
}
/** 从审计流水派生实测指标——这是唯一有真实数据的来源。 */
function metricsFromAudit(entries) {
    const byTool = {};
    let blocked = 0;
    let asked = 0;
    let redacted = 0;
    let truncated = 0;
    let trashed = 0;
    for (const entry of entries) {
        const tool = String(entry?.tool ?? 'unknown');
        byTool[tool] = (byTool[tool] ?? 0) + 1;
        if (entry?.result === 'BLOCKED')
            blocked += 1;
        if (entry?.result === 'ASKED')
            asked += 1;
        const note = String(entry?.error ?? '');
        if (note.startsWith('redacted'))
            redacted += 1;
        if (note.startsWith('truncated'))
            truncated += 1;
        if (note.startsWith('trash'))
            trashed += 1;
    }
    const top = Object.entries(byTool)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([name, count]) => ({ name, count }));
    return { total: entries.length, blocked, asked, redacted, truncated, trashed, top };
}
function sandboxSummary(config) {
    const sandbox = config?.sandbox ?? {};
    const rules = sandbox.rules ?? {};
    const workspaces = normalizeWorkspaces(sandbox.workspaces).workspaces;
    return {
        mode: sandbox.mode,
        approval: sandbox.approval,
        commandDefault: sandbox.commandDefault ?? 'allow',
        networkDefault: sandbox.networkDefault,
        workspaces: workspaces.map((ws) => ({
            profile: ws.profile,
            root: ws.root,
            mode: ws.permissionMode ?? sandbox.mode ?? 'workspace-write',
        })),
        files: (rules.files ?? []).length,
        commands: (rules.commands ?? []).length,
        network: (rules.network ?? []).length,
        toolControl: Object.keys(sandbox.toolControl ?? {}).length,
        injectionGuard: sandbox.injectionGuard,
        sensitiveProtection: sandbox.sensitiveProtection,
    };
}
async function buildState(service) {
    const config = service.getConfig?.() ?? {};
    const [health, auditAll] = await Promise.all([
        service.healthCheck().catch((error) => ({ status: 'unhealthy', error: String(error?.message ?? error) })),
        service.getAuditLogs({ limit: 200 }).catch(() => []),
    ]);
    const audit = auditAll.slice(-20);
    const observed = metricsFromAudit(auditAll);
    const usage = await trashUsage(config.stateDir).catch(() => ({ dir: null, files: 0, bytes: 0, stamps: 0 }));
    const isolation = await verifyIsolation(service, normalizeGovernance(service.governance ?? config.governance).profile).catch(() => null);
    return {
        health,
        isolation,
        governance: normalizeGovernance(service.governance ?? config.governance),
        sandbox: sandboxSummary(config),
        context: config.context ?? {},
        loop: config.loop ?? {},
        audit,
        observed,
        trash: {
            ...usage,
            retentionDays: config.sandbox?.trashRetentionDays ?? 7,
            maxMB: config.sandbox?.trashMaxMB ?? 256,
            recent: await listTrash(config.stateDir, 6).catch(() => []),
        },
        truncation: governanceStats(service),
        prune: {
            mode: normalizeGovernance(service.governance ?? config.governance).pruner.mode,
            steps: governanceStats(service).pruneSteps ?? 0,
            reclaimable: governanceStats(service).pruneReclaimable ?? 0,
            shape: governanceStats(service).lastShape ?? null,
            saved: governanceStats(service).pruneSaved ?? 0,
        },
        registry: {
            tools: (service.registry?.listTools?.() ?? []).map((tool) => tool.name),
            templates: (service.registry?.listTemplates?.() ?? []).map((template) => template.name),
            workspaces: (service.registry?.listWorkspaces?.() ?? []).map((workspace) => ({
                profile: workspace.profile,
                root: workspace.root,
                trusted: workspace.trusted !== false,
            })),
        },
        metrics: (service.getMetrics?.() ?? []).slice(-10),
    };
}
async function handle(service, method, body) {
    switch (method) {
        case 'state':
            return buildState(service);
        case 'audit': {
            const limit = Number(body?.limit) > 0 ? Math.min(200, Number(body.limit)) : 50;
            return {
                entries: await service.getAuditLogs({
                    limit,
                    ...(typeof body?.tool === 'string' && body.tool ? { tool: body.tool } : {}),
                }),
            };
        }
        case 'governance': {
            const merged = normalizeGovernance({ ...(service.governance ?? {}), ...pickGovernance(body?.governance) });
            // Mutating the object the hooks captured means the change is live; the
            // `enabled` flag is re-read on every call, so turning it off needs no
            // re-registration either.
            Object.assign(service.governance ?? {}, merged);
            await saveGovernance(service, merged);
            return { governance: merged };
        }
        case 'sandbox': {
            const current = service.getConfig?.() ?? {};
            const { workspaces, errors } = normalizeWorkspaces(body?.workspaces);
            if (errors.length)
                throw new Error(errors.join('；'));
            const commandDefault = ['allow', 'ask', 'deny'].includes(body?.commandDefault) ? body.commandDefault : 'allow';
            const networkDefault = ['allow', 'ask', 'deny'].includes(body?.networkDefault) ? body.networkDefault : 'deny';
            const sandbox = {
                ...(current.sandbox ?? {}),
                workspaces,
                commandDefault,
                networkDefault,
            };
            service.reloadConfig?.({ sandbox });
            registerWorkspaces(service, workspaces);
            await saveSandbox(service, { workspaces, commandDefault, networkDefault });
            return { sandbox: sandboxSummary(service.getConfig?.() ?? {}) };
        }
        case 'trash/restore': {
            const current = service.getConfig?.() ?? {};
            const result = await restoreTrash(current.stateDir, String(body?.stamp ?? ''), String(body?.file ?? ''), {
                overwrite: body?.overwrite === true,
            });
            return { result, trash: { ...(await trashUsage(current.stateDir)), recent: await listTrash(current.stateDir, 6) } };
        }
        case 'trash/clear': {
            const current = service.getConfig?.() ?? {};
            const usage = await trashUsage(current.stateDir);
            if (usage.dir)
                await rm(usage.dir, { recursive: true, force: true });
            return { trash: { ...(await trashUsage(current.stateDir)), recent: [] } };
        }
        default:
            return null;
    }
}
function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > 256 * 1024) {
                reject(new Error('request body too large'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if (!text)
                return resolve({});
            try {
                resolve(JSON.parse(text));
            }
            catch (error) {
                reject(new Error(`invalid JSON body: ${error?.message ?? error}`));
            }
        });
        req.on('error', reject);
    });
}
function writeJson(res, status, payload) {
    if (res.writableEnded)
        return;
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(payload));
}
/**
 * Register the route and hydrate the saved switches.
 *
 * @returns false when this profile has no `webServer` service (the CLI/headless
 *          case), so the caller can keep going without a page.
 */
export function mountDashboard(ctx, service) {
    const webServer = (() => {
        try {
            return ctx.get?.('webServer') ?? ctx.webServer;
        }
        catch {
            return undefined;
        }
    })();
    if (!webServer || typeof webServer.register !== 'function')
        return false;
    const connection = (() => {
        try {
            return ctx.get?.('connection') ?? ctx.connection;
        }
        catch {
            return undefined;
        }
    })();
    void loadSavedGovernance(service).catch(() => { });
    // 启动时按保留策略清一次回收站（失败不影响启动）
    {
        const cfg = service.getConfig?.() ?? {};
        void pruneTrash(cfg.stateDir, {
            retentionDays: cfg.sandbox?.trashRetentionDays ?? 7,
            maxMB: cfg.sandbox?.trashMaxMB ?? 256,
        }).catch(() => { });
    }
    void loadSavedSandbox(service).catch(() => { });
    const listener = async (req, res) => {
        try {
            if (connection?.requestRejection) {
                const rejection = connection.requestRejection(req);
                if (rejection !== undefined)
                    return writeJson(res, 403, { ok: false, error: { code: 'forbidden' } });
            }
            if (req.method !== 'POST')
                return writeJson(res, 405, { ok: false, error: { code: 'method-error' } });
            const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname;
            const method = pathname.startsWith(API_PREFIX) ? pathname.slice(API_PREFIX.length) : '';
            if (!method)
                return writeJson(res, 404, { ok: false, error: { code: 'not-found' } });
            const body = await readBody(req);
            const value = await handle(service, method, body);
            if (value === null)
                return writeJson(res, 404, { ok: false, error: { code: 'not-found', message: method } });
            return writeJson(res, 200, { ok: true, value });
        }
        catch (error) {
            return writeJson(res, 400, {
                ok: false,
                error: { code: error?.code ?? 'bad-request', message: String(error?.message ?? error) },
            });
        }
    };
    const route = { kind: 'prefix', path: '/runtime-kit/api', handler: listener };
    try {
        if (typeof ctx.effect === 'function') {
            ctx.effect(() => webServer.register(route), 'runtime-kit: dashboard routes');
        }
        else {
            webServer.register(route);
        }
    }
    catch (error) {
        ctx.logger?.warn?.(`[runtime-kit] dashboard route failed: ${String(error)}`);
        return false;
    }
    return true;
}
