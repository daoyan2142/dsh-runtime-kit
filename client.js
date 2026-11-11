/**
 * dsh-runtime-kit — Client half.
 *
 * The page exists because the plugin's abilities used to be reachable only by
 * typing `runtime_kit_*`. Everything shown here comes from `/runtime-kit/api`,
 * so the page and the commands never disagree.
 *
 * Two surfaces, one component: a Settings section (always available) and a
 * better-sidebar tab (when that plugin is installed).
 */
window.__ModuleLoader__.load({
  id: 'dsh-runtime-kit',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const isZh = /^zh/i.test((typeof navigator !== 'undefined' && navigator.language) || 'zh')
    const L = (zh, en) => (isZh ? zh : en)

    const API = '/runtime-kit/api/'

    async function call(method, body) {
      const res = await fetch(API + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body ?? {}),
      })
      const payload = await res.json().catch(() => null)
      if (!payload || payload.ok !== true) {
        const message = payload?.error?.message || `HTTP ${res.status}`
        throw new Error(message)
      }
      return payload.value
    }

    // ------------------------------------------------------------ styles ---
    const CSS = `
.rk-root{max-width:820px;display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary,inherit);font-size:13px;line-height:1.5}
.rk-root,.rk-root *{box-sizing:border-box}
.rk-hero{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.rk-h1{font-size:15px;font-weight:600;letter-spacing:.2px}
.rk-sub{font-size:12px;color:var(--dsw-alias-label-secondary,#9a9a9a)}
.rk-card{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:10px}
.rk-card-head{display:flex;align-items:center;gap:8px}
.rk-card-title{font-size:13px;font-weight:600;flex:1;min-width:0}
.rk-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.rk-stat{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.2));border-radius:10px;padding:9px 11px;display:flex;flex-direction:column;gap:2px;min-width:0}
.rk-stat-k{font-size:11.5px;color:var(--dsw-alias-label-secondary,#9a9a9a)}
.rk-stat-v{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
.rk-row{display:flex;align-items:center;gap:10px;row-gap:6px;flex-wrap:wrap;justify-content:space-between;padding:7px 0;border-top:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.14))}
.rk-row:first-child{border-top:0}
.rk-row-main{display:flex;flex-direction:column;gap:1px;min-width:0}
.rk-row-t{font-size:12.5px}
.rk-row-d{font-size:11.5px;color:var(--dsw-alias-label-secondary,#9a9a9a)}
.rk-badge{font-size:11px;padding:1px 7px;border-radius:20px;border:1px solid currentColor;white-space:nowrap}
.rk-badge.ok{color:#3fb950}.rk-badge.warn{color:#d29922}.rk-badge.bad{color:#f85149}.rk-badge.muted{color:var(--dsw-alias-label-secondary,#9a9a9a)}
.rk-btn{height:28px;padding:0 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.rk-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
.rk-btn:disabled{opacity:.5;cursor:default}
.rk-btn.primary{border-color:color-mix(in srgb,#4c8dff 55%,transparent);color:var(--dsw-alias-brand-primary,#8ab4ff);background:color-mix(in srgb,#4c8dff 13%,transparent)}
.rk-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));border-radius:8px;overflow:hidden}
.rk-seg button{height:26px;padding:0 10px;white-space:nowrap;border:0;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}
.rk-seg button.on{background:color-mix(in srgb,#4c8dff 18%,transparent);color:var(--dsw-alias-brand-primary,#7fb0ff)}
.rk-switch{position:relative;width:34px;height:19px;border-radius:20px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));background:transparent;cursor:pointer;flex:0 0 auto;padding:0}
.rk-switch.on{background:color-mix(in srgb,#4c8dff 45%,transparent);border-color:transparent}
.rk-switch::after{content:'';position:absolute;top:2px;left:2px;width:13px;height:13px;border-radius:50%;background:var(--dsw-alias-label-secondary,#9a9a9a);transition:left .12s}
.rk-switch.on::after{left:17px;background:#fff}
.rk-input{height:28px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:transparent;color:inherit;padding:0 8px;font:inherit;font-size:12px;min-width:0}
.rk-num{width:110px;height:28px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.3));background:transparent;color:inherit;padding:0 8px;font:inherit;font-size:12px;text-align:right}
.rk-mono{font-family:var(--dsw-font-mono,ui-monospace,Consolas,monospace);font-size:11.5px;color:var(--dsw-alias-label-secondary,#9a9a9a);word-break:break-all}
.rk-table{width:100%;border-collapse:collapse;font-size:11.5px}
.rk-table th{text-align:left;font-weight:500;color:var(--dsw-alias-label-secondary,#9a9a9a);padding:4px 6px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.2));white-space:nowrap}
.rk-table td{padding:4px 6px;border-bottom:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.1));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}
.rk-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
.rk-strip .rk-stat{padding:8px 10px}
.rk-zone{display:flex;align-items:baseline;gap:8px;margin-top:12px;padding:0 2px}
.rk-zone-t{font-size:12.5px;font-weight:600;letter-spacing:.2px}
.rk-zone-h{font-size:11.5px;color:var(--dsw-alias-label-secondary,#9a9a9a)}
.rk-impact{font-size:11.5px;color:var(--dsw-alias-label-secondary,#9a9a9a);font-family:var(--dsw-font-mono,ui-monospace,Consolas,monospace);padding-top:2px}
.rk-note{font-size:12px;color:var(--dsw-alias-brand-primary,#8ab4ff)}
.rk-details{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));border-radius:12px;padding:8px 16px;display:flex;flex-direction:column;gap:8px}
.rk-details summary{cursor:pointer;font-size:12.5px;font-weight:600;list-style:none}
.rk-details summary::-webkit-details-marker{display:none}
.rk-details summary::before{content:'▸';display:inline-block;margin-right:6px;transition:transform .12s}
.rk-details[open] summary::before{transform:rotate(90deg)}
.rk-savebar{position:sticky;bottom:0;display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-1,#1b1b1d) 92%,transparent);border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));box-shadow:0 4px 18px rgba(0,0,0,.28);font-size:12px}
.rk-chips{display:flex;flex-wrap:wrap;gap:5px}
.rk-chip{font-family:var(--dsw-font-mono,ui-monospace,monospace);font-size:11px;padding:1px 6px;border-radius:6px;background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}
.rk-scroll{overflow-x:auto;max-width:100%}
.rk-empty{font-size:12px;color:var(--dsw-alias-label-secondary,#9a9a9a);padding:2px 0}
.rk-err{font-size:12px;color:#f85149}
`

    let cssReady = false
    function ensureCss() {
      if (cssReady || typeof document === 'undefined') return
      cssReady = true
      const style = document.createElement('style')
      style.id = 'runtime-kit-style'
      style.textContent = CSS
      document.head.appendChild(style)
    }

    // ------------------------------------------------------------ pieces ---

    function Card({ title, right, children }) {
      const head = title || right ? h('div', { className: 'rk-card-head' }, h('div', { className: 'rk-card-title' }, title), right || null) : null
      return h('div', { className: 'rk-card' }, head, children)
    }

    function Stat({ label, value, tone }) {
      return h(
        'div',
        { className: 'rk-stat' },
        h('div', { className: 'rk-stat-k' }, label),
        h(
          'div',
          {
            className: 'rk-stat-v',
            style: {
              ...(tone ? { color: tone } : null),
              // 字符串值（workspace-write / deny）比数字长，缩小一号才不折行
              ...(typeof value === 'string' && value.length > 8 ? { fontSize: '14px' } : null),
            },
          },
          String(value ?? '—'),
        ),
      )
    }

    function Switch({ on, onChange, disabled }) {
      return h('button', {
        type: 'button',
        className: `rk-switch${on ? ' on' : ''}`,
        'aria-pressed': on ? 'true' : 'false',
        disabled,
        onClick: () => onChange(!on),
      })
    }

    function ToggleRow({ title, desc, on, disabled, onChange }) {
      return h(
        'div',
        { className: 'rk-row' },
        h(
          'div',
          { className: 'rk-row-main' },
          h('div', { className: 'rk-row-t' }, title),
          desc ? h('div', { className: 'rk-row-d' }, desc) : null,
        ),
        h(Switch, { on, onChange, disabled }),
      )
    }

    function toneOf(status) {
      if (status === 'healthy') return 'ok'
      if (status === 'degraded') return 'warn'
      return 'bad'
    }

    function fmtBytes(value) {
      const n = Number(value) || 0
      if (n < 1024) return `${n} B`
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
      return `${(n / 1024 / 1024).toFixed(1)} MB`
    }

    function describeShape(shape) {
      if (!shape || typeof shape !== 'object') return L('尚无', 'none')
      const roles = Object.entries(shape.roles || {})
        .map(([role, count]) => role + '×' + count)
        .join(' ')
      const blocks = Object.entries(shape.blockTypes || {})
        .map(([type, count]) => type + '×' + count)
        .slice(0, 4)
        .join(' ')
      return (roles || L('无消息', 'no messages')) + (blocks ? ' · ' + blocks : '')
    }

    function stamp(iso) {
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return String(iso || '')
      const p = (n) => String(n).padStart(2, '0')
      return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    }

    // -------------------------------------------------------------- panel ---

    function RuntimeKitPanel({ initial }) {
      ensureCss()
      // `initial` exists for the render tests: SSR runs no effects, so a page
      // that only fetches would always screenshot as "loading".
      const [state, setState] = useState(initial || null)
      const [governance, setGovernance] = useState(initial?.governance || null)
      const [draft, setDraft] = useState(
        initial
          ? {
              workspaces: initial.sandbox?.workspaces || [],
              commandDefault: initial.sandbox?.commandDefault || 'allow',
              networkDefault: initial.sandbox?.networkDefault || 'deny',
            }
          : null,
      )
      const [wsNew, setWsNew] = useState({ profile: 'default', root: '', mode: 'workspace-write' })
      const [armed, setArmed] = useState('')
      const [auditAll, setAuditAll] = useState(false)
      const [busy, setBusy] = useState('')
      const [note, setNote] = useState('')
      const [error, setError] = useState('')

      const load = useCallback(async () => {
        setBusy('load')
        setError('')
        try {
          const value = await call('state')
          setState(value)
          setGovernance(value.governance)
          setDraft({
            workspaces: value.sandbox?.workspaces || [],
            commandDefault: value.sandbox?.commandDefault || 'allow',
            networkDefault: value.sandbox?.networkDefault || 'deny',
          })
        } catch (e) {
          setError(String(e.message || e))
        } finally {
          setBusy('')
        }
      }, [])

      useEffect(() => {
        load()
      }, [load])

      const governanceDirty = Boolean(
        state && governance && JSON.stringify(state.governance) !== JSON.stringify(governance),
      )
      const sandboxDirty = Boolean(
        draft &&
          state &&
          JSON.stringify({
            workspaces: draft.workspaces,
            commandDefault: draft.commandDefault,
            networkDefault: draft.networkDefault,
          }) !==
            JSON.stringify({
              workspaces: state.sandbox?.workspaces || [],
              commandDefault: state.sandbox?.commandDefault || 'allow',
              networkDefault: state.sandbox?.networkDefault || 'deny',
            }),
      )
      const dirtyCount = (governanceDirty ? 1 : 0) + (sandboxDirty ? 1 : 0)

      const save = async () => {
        if (!dirtyCount) return
        setBusy('save')
        setNote('')
        setError('')
        try {
          if (governanceDirty) await call('governance', { governance })
          if (sandboxDirty) {
            await call('sandbox', {
              workspaces: draft.workspaces,
              commandDefault: draft.commandDefault,
              networkDefault: draft.networkDefault,
            })
          }
          setNote(L('已保存，立即生效', 'Saved, effective now'))
          await load()
        } catch (e) {
          setError(String(e.message || e))
        } finally {
          setBusy('')
        }
      }

      const discard = () => {
        if (!state) return
        setGovernance(state.governance)
        setDraft({
          workspaces: state.sandbox?.workspaces || [],
          commandDefault: state.sandbox?.commandDefault || 'allow',
          networkDefault: state.sandbox?.networkDefault || 'deny',
        })
        setNote('')
      }

      // 一键推荐：安全的全开，会改输出的先观察，会拒绝的保持关闭。
      const applyRecommended = async () => {
        const base = governance || {}
        setGovernance({
          ...base,
          enabled: true,
          audit: true,
          redaction: true,
          injection: 'annotate',
          sandbox: false,
          truncation: { ...(base.truncation || { maxBytes: 4096, spill: true, perTool: {} }), mode: 'shadow' },
          pruner: { ...(base.pruner || { keepTurns: 4, maxChars: 2000 }), mode: 'shadow' },
        })
        setBusy('recommend')
        try {
          await call('governance', {
            governance: {
              ...base,
              enabled: true,
              audit: true,
              redaction: true,
              injection: 'annotate',
              sandbox: false,
              truncation: { ...(base.truncation || { maxBytes: 4096, spill: true, perTool: {} }), mode: 'shadow' },
              pruner: { ...(base.pruner || { keepTurns: 4, maxChars: 2000 }), mode: 'shadow' },
            },
          })
          setNote(L('已套用推荐配置', 'Recommended settings applied'))
          await load()
        } catch (e) {
          setError(String(e.message || e))
        } finally {
          setBusy('')
        }
      }

      const restore = async (entry) => {
        const key = entry.stamp + '/' + entry.file
        setError('')
        try {
          const result = await call('trash/restore', {
            stamp: entry.stamp,
            file: entry.file,
            overwrite: armed === key,
          })
          const status = result?.result?.status
          if (status === 'restored') {
            setArmed('')
            setNote(L('已恢复：', 'Restored: ') + result.result.target)
            await load()
          } else if (status === 'conflict') {
            setArmed(key)
            setNote(L('原路径还在，再点一次覆盖：', 'Target exists — click again to overwrite: ') + result.result.target)
          } else {
            setNote(L('副本已不存在。', 'That copy is gone.'))
          }
        } catch (e) {
          setError(String(e.message || e))
        }
      }

      const health = state?.health || {}
      const audit = state?.audit || []
      const registry = state?.registry || { tools: [], templates: [], workspaces: [] }
      const sandbox = state?.sandbox || {}
      const context = state?.context || {}
      const metrics = state?.metrics || []
      const observed = state?.observed || {}
      const truncation = governance?.truncation || { mode: 'off', maxBytes: 4096, spill: true, perTool: {} }
      const projection = governance?.projection || { mode: 'off', maxLines: {} }
      const pruner = governance?.pruner || { mode: 'off', keepTurns: 4, maxChars: 2000 }
      const truncStats = state?.truncation || {}
      const todayEntries = Array.isArray(state?.auditToday)
        ? state.auditToday
        : (audit || []).filter((entry) => {
            const at = new Date(entry?.timestamp ?? 0)
            return !Number.isNaN(at.getTime()) && at.toDateString() === new Date().toDateString()
          })

      const on = (value) => Boolean(value)
      const hasWorkspace = (draft?.workspaces || []).length > 0

      return h(
        'div',
        { className: 'rk-root' },
        // ---------------- header: 状态 + 两个动作 ----------------
        h(
          'div',
          { className: 'rk-hero' },
          h('div', { className: 'rk-h1' }, L('运行时治理', 'Runtime governance')),
          h('span', { className: `rk-badge ${toneOf(health.status)}` }, health.status || '—'),
          h('div', { className: 'rk-sub' }, `v${health.version || '—'}`),
          h('div', { style: { flex: '1' } }),
          h(
            'button',
            { className: 'rk-btn', onClick: applyRecommended, disabled: Boolean(busy) },
            L('套用推荐', 'Recommended'),
          ),
          h('button', { className: 'rk-btn', onClick: load, disabled: Boolean(busy) }, L('刷新', 'Refresh')),
        ),

        h(
          'div',
          { className: 'rk-sub' },
          L(
            '三组从上到下：① 默认就该开的防护，不用管；② 想省 token 再开，会改变模型看到的内容；③ 会拒绝操作，先配工作区。',
            'Three groups: (1) protection you should leave on; (2) token savers that change what the model sees; (3) gating that can block — configure a workspace first.',
          ),
        ),

        error ? h('div', { className: 'rk-err' }, error) : null,
        note ? h('div', { className: 'rk-note' }, note) : null,

        // ---------------- status strip ----------------
        h(
          'div',
          { className: 'rk-strip' },
          h(Stat, { label: L('今天调用', 'Calls today'), value: todayEntries.length }),
          h(Stat, { label: L('被拒绝', 'Blocked'), value: observed.blocked ?? 0 }),
          h(Stat, { label: L('截断命中', 'Truncated'), value: observed.truncated ?? 0 }),
          h(Stat, { label: L('回收站', 'Trash'), value: (state?.trash && state.trash.files) || 0 }),
        ),

        // ---------------- zone 1: 基础防护 ----------------
        h('div', { className: 'rk-zone' }, h('span', { className: 'rk-zone-t' }, L('① 基础防护', 'Protection')), h('span', { className: 'rk-badge ok' }, L('无风险', 'safe')), h('span', { className: 'rk-zone-h' }, L('不会拒绝任何调用', 'never blocks a call'))),
        h(
          Card,
          null,
          h(ToggleRow, {
            key: 'audit',
            title: L('审计', 'Audit'),
            desc: L('每次工具调用记一条，页面上的数字都来自它', 'One line per tool call; every number on this page comes from it'),
            on: on(governance?.audit),
            disabled: Boolean(busy),
            onChange: (value) => setGovernance({ ...governance, audit: value }),
          }),
          h(ToggleRow, {
            key: 'redaction',
            title: L('脱敏', 'Redaction'),
            desc: L('返回体里的密钥替换成 [redacted:kind]', 'Replace secrets with [redacted:kind]'),
            on: on(governance?.redaction),
            disabled: Boolean(busy),
            onChange: (value) => setGovernance({ ...governance, redaction: value }),
          }),
          h(
            'div',
            { className: 'rk-row' },
            h(
              'div',
              { className: 'rk-row-main' },
              h('div', { className: 'rk-row-t' }, L('提示注入', 'Prompt injection')),
              h('div', { className: 'rk-row-d' }, L('工具返回里出现"改变模型行为"的指令时怎么处理', 'What to do when tool output tries to steer the model')),
            ),
            h(
              'div',
              { className: 'rk-seg' },
              ...[
                ['off', L('不检测', 'off')],
                ['annotate', L('标注', 'annotate')],
                ['block', L('拦截', 'block')],
              ].map(([value, label]) =>
                h(
                  'button',
                  {
                    key: value,
                    className: governance?.injection === value ? 'on' : '',
                    onClick: () => setGovernance({ ...governance, injection: value }),
                  },
                  label,
                ),
              ),
            ),
          ),
        ),

        h(
          'div',
          { className: 'rk-impact', style: { padding: '0 4px 4px' } },
          L(
            '实测：脱敏 ' + (truncStats.redactions || 0) + ' 次 · 注入命中 ' + (truncStats.injectionHits || 0) + ' 次 · 今天记录 ' + todayEntries.length + ' 条',
            'measured: redacted ' + (truncStats.redactions || 0) + ' · injection ' + (truncStats.injectionHits || 0) + ' · today ' + todayEntries.length,
          ),
        ),

        // ---------------- zone 2: 上下文节省 ----------------
        h('div', { className: 'rk-zone' }, h('span', { className: 'rk-zone-t' }, L('② 上下文节省', 'Context')), h('span', { className: 'rk-badge warn' }, L('改变输出', 'changes output')), h('span', { className: 'rk-zone-h' }, L('只在你想省 token 时打开', 'turn on only to save tokens'))),
        h(
          Card,
          null,
          h(
            'div',
            { className: 'rk-row' },
            h(
              'div',
              { className: 'rk-row-main' },
              h('div', { className: 'rk-row-t' }, L('返回体裁剪', 'Tool-output truncation')),
              h('div', { className: 'rk-row-d' }, L('超预算就切开，全文落到 spill 目录；"只记账"不改变任何返回', 'Cut over budget; full text goes to spill. "shadow" changes nothing')),
              h(
                'div',
                { className: 'rk-impact' },
                L(
                  '实测：命中 ' + (truncStats.truncated || 0) + ' 次 · 省 ' + fmtBytes(truncStats.savedBytes || 0),
                  'measured: ' + (truncStats.truncated || 0) + ' hits · saved ' + fmtBytes(truncStats.savedBytes || 0),
                ),
              ),
            ),
            h(
              'div',
              { className: 'rk-seg' },
              ...[
                ['off', L('关', 'off')],
                ['shadow', L('只记账', 'shadow')],
                ['on', L('开', 'on')],
              ].map(([value, label]) =>
                h(
                  'button',
                  {
                    key: value,
                    className: truncation.mode === value ? 'on' : '',
                    onClick: () => setGovernance({ ...governance, truncation: { ...truncation, mode: value } }),
                  },
                  label,
                ),
              ),
            ),
            h('input', {
              type: 'number',
              className: 'rk-num',
              min: 256,
              step: 256,
              value: truncation.maxBytes,
              onChange: (e) =>
                setGovernance({ ...governance, truncation: { ...truncation, maxBytes: Number(e.target.value) || 0 } }),
            }),
          ),
          h(
            'div',
            { className: 'rk-row' },
            h(
              'div',
              { className: 'rk-row-main' },
              h('div', { className: 'rk-row-t' }, L('行投影', 'Line projection')),
              h('div', { className: 'rk-row-d' }, L('按整行裁剪，适合表格和搜索结果；不影响普通文本', 'Drops whole lines — good for tables; text is untouched')),
              h(
                'div',
                { className: 'rk-impact' },
                L(
                  '实测：命中 ' + (truncStats.projectedCalls || 0) + ' 次 · 裁掉 ' + (truncStats.projectedLines || 0) + ' 行',
                  'measured: ' + (truncStats.projectedCalls || 0) + ' hits · ' + (truncStats.projectedLines || 0) + ' lines dropped',
                ),
              ),
            ),
            h(
              'div',
              { className: 'rk-seg' },
              ...[
                ['off', L('关', 'off')],
                ['on', L('开', 'on')],
              ].map(([value, label]) =>
                h(
                  'button',
                  {
                    key: value,
                    className: (projection.mode || 'off') === value ? 'on' : '',
                    onClick: () => setGovernance({ ...governance, projection: { ...projection, mode: value } }),
                  },
                  label,
                ),
              ),
            ),
            h('input', {
              type: 'number',
              className: 'rk-num',
              min: 0,
              step: 50,
              value: projection.maxLines?.default ?? 0,
              onChange: (e) =>
                setGovernance({
                  ...governance,
                  projection: { ...projection, maxLines: { ...(projection.maxLines || {}), default: Number(e.target.value) || 0 } },
                }),
            }),
          ),
          h(
            'div',
            { className: 'rk-row' },
            h(
              'div',
              { className: 'rk-row-main' },
              h('div', { className: 'rk-row-t' }, L('历史裁剪', 'History pruning')),
              h('div', { className: 'rk-row-d' }, L('缩短很旧的工具返回；不删消息、不删块、最近几轮不动', 'Shortens old tool results; never removes a message or block')),
              h(
                'div',
                { className: 'rk-impact' },
                L(
                  '实测：可回收 ' + fmtBytes(state?.prune?.reclaimable || 0) + (state?.prune?.saved ? ' · 已省 ' + fmtBytes(state.prune.saved) : ''),
                  'measured: reclaimable ' + fmtBytes(state?.prune?.reclaimable || 0) + (state?.prune?.saved ? ' · saved ' + fmtBytes(state.prune.saved) : ''),
                ),
              ),
            ),
            h(
              'div',
              { className: 'rk-seg' },
              ...[
                ['off', L('关', 'off')],
                ['shadow', L('观察', 'observe')],
                ['on', L('开', 'on')],
              ].map(([value, label]) =>
                h(
                  'button',
                  {
                    key: value,
                    className: (pruner.mode || 'off') === value ? 'on' : '',
                    onClick: () => setGovernance({ ...governance, pruner: { ...pruner, mode: value } }),
                  },
                  label,
                ),
              ),
            ),
          ),

        ),

        // ---------------- zone 3: 沙箱 ----------------
        h('div', { className: 'rk-zone' }, h('span', { className: 'rk-zone-t' }, L('③ 沙箱保护', 'Sandbox')), h('span', { className: 'rk-badge bad' }, L('可能拒绝', 'can block')), h('span', { className: 'rk-zone-h' }, L('配好工作区再开', 'configure a workspace first'))),
        h(
          Card,
          null,
          h(ToggleRow, {
            key: 'sandbox',
            title: L('启用拦截', 'Enable gate'),
            desc: hasWorkspace
              ? L('按文件/命令/网络规则拒绝调用；危险前缀默认已拦', 'Deny by file/command/network rules')
              : L('先添加一个工作区，否则所有带路径的调用都会被拒绝', 'Add a workspace first, or every path-bearing call is denied'),
            on: on(governance?.sandbox),
            disabled: Boolean(busy),
            onChange: (value) => {
              if (value && !hasWorkspace) {
                setNote(L('先添加工作区再打开。', 'Add a workspace first.'))
                return
              }
              setGovernance({ ...governance, sandbox: value })
            },
          }),
          h('div', { className: 'rk-sub' }, L('工作区（允许读写的边界）', 'Workspaces (the boundary)')),
          (draft?.workspaces || []).length
            ? h(
                'div',
                { style: { display: 'flex', flexDirection: 'column' } },
                ...(draft.workspaces || []).map((workspace, index) =>
                  h(
                    'div',
                    { key: workspace.profile, className: 'rk-row' },
                    h(
                      'div',
                      { className: 'rk-row-main' },
                      h('div', { className: 'rk-row-t' }, workspace.profile),
                      h('div', { className: 'rk-row-d' }, workspace.root + ' · ' + (workspace.mode || 'workspace-write')),
                    ),
                    h(
                      'button',
                      {
                        className: 'rk-btn',
                        onClick: () =>
                          setDraft({ ...draft, workspaces: (draft.workspaces || []).filter((_, i) => i !== index) }),
                      },
                      '×',
                    ),
                  ),
                ),
              )
            : h('div', { className: 'rk-empty' }, L('还没有工作区。', 'No workspace yet.')),
          h(
            'div',
            { className: 'rk-row' },
            h('input', {
              className: 'rk-input',
              style: { flex: '0 1 110px' },
              value: wsNew.profile,
              placeholder: L('名字', 'name'),
              onChange: (e) => setWsNew({ ...wsNew, profile: e.target.value }),
            }),
            h('input', {
              className: 'rk-input',
              style: { flex: '1 1 180px' },
              value: wsNew.root,
              placeholder: 'D:\\work',
              onChange: (e) => setWsNew({ ...wsNew, root: e.target.value }),
            }),
            h(
              'button',
              {
                className: 'rk-btn',
                disabled: !wsNew.profile.trim() || !wsNew.root.trim(),
                onClick: () => {
                  setDraft({
                    ...draft,
                    workspaces: [
                      ...(draft?.workspaces || []),
                      { profile: wsNew.profile.trim(), root: wsNew.root.trim(), mode: wsNew.mode },
                    ],
                  })
                  setWsNew({ ...wsNew, root: '' })
                },
              },
              L('添加', 'Add'),
            ),
          ),
          h(
            'div',
            { className: 'rk-row' },
            h(
              'div',
              { className: 'rk-row-main' },
              h('div', { className: 'rk-row-t' }, L('命令默认策略', 'Command default')),
              h('div', { className: 'rk-row-d' }, L('没命中规则时的行为','When no rule matches')),
            ),
            h(
              'div',
              { className: 'rk-seg' },
              ...[['allow', L('允许', 'allow')], ['ask', L('询问', 'ask')], ['deny', L('拒绝', 'deny')]].map(([value, label]) =>
                h(
                  'button',
                  {
                    key: value,
                    className: (draft?.commandDefault || 'allow') === value ? 'on' : '',
                    onClick: () => setDraft({ ...draft, commandDefault: value }),
                  },
                  label,
                ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'rk-row' },
            h(
              'div',
              { className: 'rk-row-main' },
              h('div', { className: 'rk-row-t' }, L('网络默认策略', 'Network default')),
              h('div', { className: 'rk-row-d' }, L('域名不在任何规则里时的行为', 'Domains without a rule')),
            ),
            h(
              'div',
              { className: 'rk-seg' },
              ...[['allow', L('允许', 'allow')], ['ask', L('询问', 'ask')], ['deny', L('拒绝', 'deny')]].map(([value, label]) =>
                h(
                  'button',
                  {
                    key: value,
                    className: (draft?.networkDefault || 'deny') === value ? 'on' : '',
                    onClick: () => setDraft({ ...draft, networkDefault: value }),
                  },
                  label,
                ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'rk-row' },
            h(
              'div',
              { className: 'rk-row-main' },
              h('div', { className: 'rk-row-t' }, L('回收站', 'Trash')),
              h(
                'div',
                { className: 'rk-row-d' },
                (state?.trash?.files || 0) +
                  L(' 个文件 · ', ' files · ') +
                  fmtBytes(state?.trash?.bytes || 0) +
                  ' · ' +
                  L('保留 ', 'keep ') +
                  (state?.trash?.retentionDays ?? 7) +
                  L(' 天', 'd'),
              ),
            ),
            h(
              'button',
              {
                className: 'rk-btn',
                disabled: !(state?.trash?.files > 0) || Boolean(busy),
                onClick: async () => {
                  try {
                    await call('trash/clear', {})
                    await load()
                  } catch (e) {
                    setError(String(e.message || e))
                  }
                },
              },
              L('清空', 'Clear'),
            ),
          ),
          (state?.trash?.recent || []).map((entry) =>
            h(
              'div',
              { key: entry.stamp + '/' + entry.file, className: 'rk-row' },
              h(
                'div',
                { className: 'rk-row-main' },
                h('div', { className: 'rk-row-t' }, entry.original),
                h('div', { className: 'rk-row-d' }, stamp(entry.at) + ' · ' + fmtBytes(entry.bytes)),
              ),
              h(
                'button',
                { className: 'rk-btn', onClick: () => restore(entry) },
                armed === entry.stamp + '/' + entry.file ? L('确认覆盖', 'Confirm') : L('恢复', 'Restore'),
              ),
            ),
          ),
          h(
            'div',
            { className: 'rk-sub' },
            L('基线 ', 'Mode ') + (sandbox.mode || '—') + ' · ' + L('审批 ', 'Approval ') + (sandbox.approval || '—') + ' · ' + L('规则 ', 'Rules ') + (sandbox.files || 0) + '/' + (sandbox.commands || 0) + '/' + (sandbox.network || 0),
          ),
        ),

        h(
          'div',
          { className: 'rk-impact', style: { padding: '0 4px 4px' } },
          L(
            '实测：拦截 ' + (observed.blocked || 0) + ' 次 · 询问 ' + (observed.asked || 0) + ' 次',
            'measured: blocked ' + (observed.blocked || 0) + ' · asked ' + (observed.asked || 0),
          ),
        ),

        // ---------------- details ----------------
        h(
          'details',
          { className: 'rk-details' },
          h('summary', null, L('审计流水（今天 ' + todayEntries.length + ' 条）', 'Audit log (today: ' + todayEntries.length + ')')),
          todayEntries.length
            ? h(
                'div',
                { className: 'rk-scroll' },
                h(
                  'table',
                  { className: 'rk-table' },
                  h(
                    'thead',
                    null,
                    h(
                      'tr',
                      null,
                      h('th', null, L('时间', 'Time')),
                      h('th', null, L('工具', 'Tool')),
                      h('th', null, L('结果', 'Result')),
                      h('th', null, L('备注', 'Note')),
                    ),
                  ),
                  h(
                    'tbody',
                    null,
                    (auditAll ? todayEntries : todayEntries.slice(-8))
                      .slice()
                      .reverse()
                      .map((entry, i) =>
                        h(
                          'tr',
                          { key: `${entry.timestamp}-${i}` },
                          h('td', { className: 'rk-mono' }, stamp(entry.timestamp)),
                          h('td', { className: 'rk-mono' }, entry.tool + (entry.action === 'block' ? ' ⛔' : '')),
                          h(
                            'td',
                            null,
                            h(
                              'span',
                              {
                                className: `rk-badge ${
                                  entry.result === 'SUCCESS' ? 'ok' : entry.result === 'ASKED' ? 'warn' : 'bad'
                                }`,
                              },
                              entry.result,
                            ),
                          ),
                          h('td', { className: 'rk-mono', title: entry.error || '' }, entry.error || ''),
                        ),
                      ),
                  ),
                ),
              )
            : h('div', { className: 'rk-empty' }, L('今天还没有调用记录。', 'No calls today.')),
          h(
            'div',
            { className: 'rk-sub' },
            L(
              '默认显示最近 8 条；更早的 ' + (state?.auditOlder || 0) + ' 条不在页面展开',
              'Last 8 by default; ' + (state?.auditOlder || 0) + ' older entries are not listed',
            ),
          ),
          todayEntries.length > 8
            ? h(
                'button',
                { className: 'rk-btn', onClick: () => setAuditAll((value) => !value) },
                auditAll ? L('收起', 'Collapse') : L('展开今天的全部', 'Show all today'),
              )
            : null,
        ),

        h(
          'details',
          { className: 'rk-details' },
          h('summary', null, L('注册表与快路径', 'Registry and fast-path')),
          h('div', { className: 'rk-sub' }, L('工具', 'Tools')),
          h(
            'div',
            { className: 'rk-chips' },
            ...(registry.tools.length
              ? registry.tools.map((name) => h('span', { key: name, className: 'rk-chip' }, name))
              : [h('span', { key: 'none', className: 'rk-empty' }, L('无', 'none'))]),
          ),
          h('div', { className: 'rk-sub' }, L('模板', 'Templates')),
          h(
            'div',
            { className: 'rk-chips' },
            ...(registry.templates.length
              ? registry.templates.map((name) => h('span', { key: name, className: 'rk-chip' }, name))
              : [h('span', { key: 'none', className: 'rk-empty' }, L('无', 'none'))]),
          ),
          h('div', { className: 'rk-sub' }, L('工作区', 'Workspaces')),
          h(
            'div',
            { className: 'rk-chips' },
            ...(registry.workspaces.length
              ? registry.workspaces.map((workspace) =>
                  h('span', { key: workspace.profile, className: 'rk-chip' }, `${workspace.profile} → ${workspace.root}`),
                )
              : [h('span', { key: 'none', className: 'rk-empty' }, L('未注册', 'none'))]),
          ),
          h(
            'div',
            { className: 'rk-sub' },
            L(
              'pruner / compaction 与延迟工具加载由宿主负责（' + (context.maxReturnBytes || 4096) + ' B 是本插件自己的预算）',
              'pruner/compaction and lazy loading are host features; ' + (context.maxReturnBytes || 4096) + ' B is this plugin own budget',
            ),
          ),
        ),

        // ---------------- sticky save ----------------
        dirtyCount
          ? h(
              'div',
              { className: 'rk-savebar' },
              h('span', null, L('有 ' + dirtyCount + ' 处修改未保存', dirtyCount + ' unsaved change(s)')),
              h('div', { style: { flex: '1' } }),
              h('button', { className: 'rk-btn', onClick: discard, disabled: busy === 'save' }, L('放弃', 'Discard')),
              h(
                'button',
                { className: 'rk-btn primary', onClick: save, disabled: busy === 'save' },
                busy === 'save' ? L('保存中', 'Saving') : L('保存', 'Save'),
              ),
            )
          : null,
      )
    }

    function SettingsSection() {
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } }, h(RuntimeKitPanel))
    }

    // Icon: a small shield, drawn inline so the client half stays dependency-free.
    function Icon({ size = 16 } = {}) {
      const s = typeof size === 'number' ? size : 16
      return h(
        'svg',
        { width: s, height: s, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M8 1.6 13 3.4v4.2c0 3-2 5.6-5 6.8-3-1.2-5-3.8-5-6.8V3.4L8 1.6Z', stroke: 'currentColor', 'stroke-width': '1.2' }),
        h('path', { d: 'M6.2 8.1 7.6 9.5l2.4-2.6', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round' }),
      )
    }

    return {
      inject: ['slots'],
      __test: { RuntimeKitPanel, SettingsSection, css: CSS },
      apply(ctx) {
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            { name: 'settings.section', id: 'runtime-kit', order: 51, label: () => L('运行时治理', 'Runtime governance') },
            SettingsSection,
          ),
        )

        const registerTab = (sidebar) => {
          if (!sidebar || typeof sidebar.registerTab !== 'function') return false
          try {
            sidebar.registerTab({
              id: 'runtime-kit',
              title: () => L('运行时', 'Runtime'),
              description: () => L('上下文治理、沙箱与审计', 'Context governance, sandbox and audit'),
              icon: Icon,
              order: 41,
              single: true,
              component: RuntimeKitPanel,
            })
            return true
          } catch {
            return false
          }
        }

        let sidebar
        try {
          sidebar = typeof ctx.get === 'function' ? ctx.get('betterSidebar') : undefined
        } catch {
          sidebar = undefined
        }
        if (!sidebar) {
          try {
            sidebar = ctx.betterSidebar
          } catch {
            sidebar = undefined
          }
        }
        if (!registerTab(sidebar) && typeof ctx.inject === 'function') {
          try {
            ctx.inject(['betterSidebar'], (inner) => {
              try {
                registerTab(inner.betterSidebar)
              } catch {
                /* service absent in that scope */
              }
            })
          } catch {
            /* no injectable service; the settings page carries the feature */
          }
        }
      },
    }
  },
})
