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

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { normalizeGovernance } from '../hooks/policy.js';

const API_PREFIX = '/runtime-kit/api/';
const ALLOWED_KEYS = ['enabled', 'audit', 'redaction', 'injection', 'sandbox', 'profile'] as const;

interface DashboardService {
  getConfig(): any;
  getMetrics(): any[];
  getAuditLogs(filter?: any): Promise<any[]>;
  healthCheck(): Promise<any>;
  registry: {
    listTools(): any[];
    listTemplates(): any[];
    listWorkspaces(): any[];
  };
  governance?: any;
}

interface DashboardCtx {
  get?(name: string): any;
  effect?(fn: any, label?: string): any;
  logger?: { warn?: (message: string) => void };
}

function governancePath(service: DashboardService): string | undefined {
  const stateDir = service.getConfig?.()?.stateDir;
  return stateDir ? join(stateDir, 'governance.json') : undefined;
}

async function loadSavedGovernance(service: DashboardService): Promise<void> {
  const file = governancePath(service);
  if (!file) return;
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'));
    Object.assign(service.governance ?? {}, normalizeGovernance(raw));
  } catch {
    /* first run, or a hand-edited file: keep the startup config */
  }
}

async function saveGovernance(service: DashboardService, governance: any): Promise<void> {
  const file = governancePath(service);
  if (!file) return;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(governance, null, 2)}\n`, 'utf8');
}

function pickGovernance(input: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ALLOWED_KEYS) {
    if (input && Object.prototype.hasOwnProperty.call(input, key)) out[key] = input[key];
  }
  return out;
}

function sandboxSummary(config: any) {
  const sandbox = config?.sandbox ?? {};
  const rules = sandbox.rules ?? {};
  return {
    mode: sandbox.mode,
    approval: sandbox.approval,
    networkDefault: sandbox.networkDefault,
    files: (rules.files ?? []).length,
    commands: (rules.commands ?? []).length,
    network: (rules.network ?? []).length,
    toolControl: Object.keys(sandbox.toolControl ?? {}).length,
    injectionGuard: sandbox.injectionGuard,
    sensitiveProtection: sandbox.sensitiveProtection,
  };
}

async function buildState(service: DashboardService) {
  const config = service.getConfig?.() ?? {};
  const [health, audit] = await Promise.all([
    service.healthCheck().catch((error: any) => ({ status: 'unhealthy', error: String(error?.message ?? error) })),
    service.getAuditLogs({ limit: 20 }).catch(() => []),
  ]);

  return {
    health,
    governance: normalizeGovernance(service.governance ?? config.governance),
    sandbox: sandboxSummary(config),
    context: config.context ?? {},
    loop: config.loop ?? {},
    audit,
    registry: {
      tools: (service.registry?.listTools?.() ?? []).map((tool: any) => tool.name),
      templates: (service.registry?.listTemplates?.() ?? []).map((template: any) => template.name),
      workspaces: (service.registry?.listWorkspaces?.() ?? []).map((workspace: any) => ({
        profile: workspace.profile,
        root: workspace.root,
        trusted: workspace.trusted !== false,
      })),
    },
    metrics: (service.getMetrics?.() ?? []).slice(-10),
  };
}

async function handle(service: DashboardService, method: string, body: any) {
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
    default:
      return null;
  }
}

function readBody(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
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
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch (error: any) {
        reject(new Error(`invalid JSON body: ${error?.message ?? error}`));
      }
    });
    req.on('error', reject);
  });
}

function writeJson(res: any, status: number, payload: unknown): void {
  if (res.writableEnded) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

/**
 * Register the route and hydrate the saved switches.
 *
 * @returns false when this profile has no `webServer` service (the CLI/headless
 *          case), so the caller can keep going without a page.
 */
export function mountDashboard(ctx: DashboardCtx, service: DashboardService): boolean {
  const webServer = (() => {
    try {
      return ctx.get?.('webServer') ?? (ctx as any).webServer;
    } catch {
      return undefined;
    }
  })();
  if (!webServer || typeof webServer.register !== 'function') return false;

  const connection = (() => {
    try {
      return ctx.get?.('connection') ?? (ctx as any).connection;
    } catch {
      return undefined;
    }
  })();

  void loadSavedGovernance(service).catch(() => {});

  const listener = async (req: any, res: any) => {
    try {
      if (connection?.requestRejection) {
        const rejection = connection.requestRejection(req);
        if (rejection !== undefined) return writeJson(res, 403, { ok: false, error: { code: 'forbidden' } });
      }
      if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: { code: 'method-error' } });

      const pathname = new URL(req.url ?? '/', 'http://dsh.internal').pathname;
      const method = pathname.startsWith(API_PREFIX) ? pathname.slice(API_PREFIX.length) : '';
      if (!method) return writeJson(res, 404, { ok: false, error: { code: 'not-found' } });

      const body = await readBody(req);
      const value = await handle(service, method, body);
      if (value === null) return writeJson(res, 404, { ok: false, error: { code: 'not-found', message: method } });
      return writeJson(res, 200, { ok: true, value });
    } catch (error: any) {
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
    } else {
      webServer.register(route);
    }
  } catch (error) {
    ctx.logger?.warn?.(`[runtime-kit] dashboard route failed: ${String(error)}`);
    return false;
  }
  return true;
}
