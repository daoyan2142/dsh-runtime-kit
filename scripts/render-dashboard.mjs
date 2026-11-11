/**
 * Render the runtime-kit page to static HTML for a visual check.
 *
 *   node scripts/render-dashboard.mjs
 * then screenshot scripts/shots/*.html with Edge --headless.
 *
 * React comes from the same .tools install the repot harness uses, so this
 * script needs no dependencies of its own.
 */
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const requireReact = createRequire('D:/Dsh/dsh-repot/.tools/package.json')
const React = requireReact('react')
const { renderToStaticMarkup } = requireReact('react-dom/server')

let captured
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      captured = definition
    },
  },
  navigator: { language: 'zh-CN' },
}

await import(pathToFileURL(join(process.cwd(), 'client.js')).href)

const client = captured.factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require: ${name}`)
})

const state = {
  health: { status: 'healthy', version: '0.3.1', dshVersion: '0.1.0', checks: {} },
  governance: { enabled: true, audit: true, redaction: true, injection: 'annotate', sandbox: false, profile: 'default', truncation: { mode: 'shadow', maxBytes: 4096, spill: true, perTool: {} } },
  truncation: { calls: 37, truncated: 9, savedBytes: 184320, spillFiles: 9, lastAt: '2026-11-11T03:02:00.000Z' },
  sandbox: {
    mode: 'workspace-write',
    approval: 'ask',
    commandDefault: 'allow',
    networkDefault: 'ask',
    workspaces: [{ profile: 'default', root: 'D:\\Dsh', mode: 'workspace-write' }],
    files: 3,
    commands: 2,
    network: 1,
    toolControl: 4,
    injectionGuard: true,
    sensitiveProtection: true,
  },
  isolation: {
    profile: 'default',
    passed: true,
    violations: [],
    checks: {
      workspace: { status: 'pass', message: 'D:\\Dsh（workspace-write）' },
      traversal: { status: 'pass', message: '越界路径被拒绝' },
      outsideRoot: { status: 'pass', message: '根外路径被拒绝' },
      network: { status: 'pass', message: '网络默认 ask' },
      symlink: { status: 'warn', message: '不做 realpath 校验' },
    },
  },
  context: { maxReturnBytes: 4096, fieldsProjection: true, prunerEnabled: true, compactionEnabled: true, lazyLoadTools: true },
  loop: { preset: 'code' },
  audit: [
    { timestamp: '2026-11-11T02:14:03.000Z', tool: 'read', action: 'return', result: 'SUCCESS', error: '', durationMs: 12 },
    { timestamp: '2026-11-11T02:14:07.000Z', tool: 'pwsh', action: 'return', result: 'SUCCESS', error: 'redacted:npm-token', durationMs: 240 },
    { timestamp: '2026-11-11T02:14:11.000Z', tool: 'web_fetch', action: 'return', result: 'BLOCKED', error: 'injection:ignore-previous', durationMs: 8 },
    { timestamp: '2026-11-11T02:14:18.000Z', tool: 'write', action: 'block', result: 'BLOCKED', error: 'sandbox:file:write', durationMs: 0 },
    { timestamp: '2026-11-11T02:14:22.000Z', tool: 'grep', action: 'return', result: 'FAILURE', error: '', durationMs: 31 },
  ],
  registry: {
    tools: ['echo', 'kv_get', 'kv_set', 'file_read', 'file_write', 'http_probe', 'crash_tool'],
    templates: ['echo-chain'],
    workspaces: [{ profile: 'default', root: 'D:\\work' }],
  },
  metrics: [
    { turn: 12, inputTokens: 18400, outputTokens: 960, toolResultBytesInContext: 5120, toolCallsCount: 6, wallClockMs: 8400 },
    { turn: 13, inputTokens: 21150, outputTokens: 1240, toolResultBytesInContext: 7680, toolCallsCount: 9, wallClockMs: 11200 },
  ],
}

const THEME = `
  :root{
    --dsw-alias-label-primary:#e6e6e6;
    --dsw-alias-label-secondary:#9a9a9a;
    --dsw-alias-border-l2:rgba(255,255,255,.16);
    --dsw-alias-bg-layer-1:#1b1b1d;
    --dsw-alias-interactive-bg-hover:rgba(255,255,255,.06);
    --dsw-alias-brand-primary:#8ab4ff;
    --dsw-font-mono:ui-monospace,Consolas,monospace;
  }
  html,body{margin:0;background:#141416;color:#e6e6e6;font-family:"Microsoft YaHei UI","Segoe UI",system-ui,sans-serif}
  body{padding:18px}
`

const html = `<!doctype html><html><head><meta charset="utf-8"><title>runtime-kit</title>
<style>${THEME}</style><style>${client.__test.css}</style>
<style>body{--stage:760px} .stage{width:var(--stage)}</style></head>
<body><div class="stage">${renderToStaticMarkup(React.createElement(client.__test.RuntimeKitPanel, { initial: state }))}</div></body></html>`

const outDir = join(process.cwd(), 'scripts', 'shots')
await mkdir(outDir, { recursive: true })
await writeFile(join(outDir, 'dashboard.html'), html, 'utf8')
console.log('wrote', join(outDir, 'dashboard.html'))




