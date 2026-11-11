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
      return h(
        'div',
        { className: 'rk-card' },
        h('div', { className: 'rk-card-head' }, h('div', { className: 'rk-card-title' }, title), right || null),
        children,
      )
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
        initial ? { workspaces: initial.sandbox?.workspaces || [], commandDefault: initial.sandbox?.commandDefault || 'allow', networkDefault: initial.sandbox?.networkDefault || 'deny' } : null,
      )
      const [wsNew, setWsNew] = useState({ profile: 'default', root: '', mode: 'workspace-write' })
      const [armed, setArmed] = useState('')
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

      const save = async () => {
        setBusy('save')
        setNote('')
        setError('')
        try {
          const value = await call('governance', { governance })
          setGovernance(value.governance)
          setNote(L('已保存，立即生效。', 'Saved. Takes effect immediately.'))
          await load()
        } catch (e) {
          setError(String(e.message || e))
        } finally {
          setBusy('')
        }
      }

      const dirty = Boolean(
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

      const saveSandbox = async () => {
        setBusy('sandbox')
        setNote('')
        setError('')
        try {
          await call('sandbox', {
            workspaces: draft.workspaces,
            commandDefault: draft.commandDefault,
            networkDefault: draft.networkDefault,
          })
          setNote(L('沙箱配置已保存。', 'Sandbox configuration saved.'))
          await load()
        } catch (e) {
          setError(String(e.message || e))
        } finally {
          setBusy('')
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
      const truncStats = state?.truncation || {}

      return h(
        'div',
        { className: 'rk-root' },
        h(
          'div',
          { className: 'rk-hero' },
          h('div', { className: 'rk-h1' }, L('运行时治理', 'Runtime governance')),
          h(
            'span',
            { className: `rk-badge ${toneOf(health.status)}` },
            health.status || (busy === 'load' ? L('读取中', 'loading') : L('未知', 'unknown')),
          ),
          h('div', { className: 'rk-sub' }, `v${health.version || '—'} · dsh ${health.dshVersion || '—'}`),
          h('div', { style: { flex: '1' } }),
          h('button', { className: 'rk-btn', onClick: load, disabled: Boolean(busy) }, L('刷新', 'Refresh')),
        ),

        error ? h('div', { className: 'rk-err' }, error) : null,

        h(
          Card,
          { title: L('总览', 'Overview') },
          h(
            'div',
            { className: 'rk-grid' },
            h(Stat, { label: L('注册工具', 'Tools'), value: registry.tools.length }),
            h(Stat, { label: L('快路径模板', 'Templates'), value: registry.templates.length }),
            h(Stat, { label: L('沙箱工作区', 'Workspaces'), value: registry.workspaces.length }),
            h(Stat, { label: L('审计条数', 'Audit entries'), value: audit.length }),
          ),
          h(
            'div',
            { className: 'rk-sub' },
            L('这些数字来自插件自身注册表，不是推测。', 'Read from the plugin registry, not guessed.'),
          ),
        ),

        h(
          Card,
          {
            title: L('治理开关', 'Governance switches'),
            right: h(
              'button',
              { className: 'rk-btn primary', onClick: save, disabled: !dirty || Boolean(busy) },
              busy === 'save' ? L('保存中', 'Saving') : L('保存', 'Save'),
            ),
          },
          governance
            ? [
                h(ToggleRow, {
                  key: 'enabled',
                  title: L('总开关', 'Master switch'),
                  desc: L('关闭后钩子仍在，但每次调用都直接放行', 'Hooks stay registered; every call passes straight through'),
                  on: governance.enabled,
                  disabled: Boolean(busy),
                  onChange: (on) => setGovernance({ ...governance, enabled: on }),
                }),
                h(ToggleRow, {
                  key: 'audit',
                  title: L('审计', 'Audit'),
                  desc: L('把每次工具调用写进审计流水（只读）', 'Record every tool call (read-only)'),
                  on: governance.audit,
                  disabled: Boolean(busy),
                  onChange: (on) => setGovernance({ ...governance, audit: on }),
                }),
                h(ToggleRow, {
                  key: 'redaction',
                  title: L('脱敏', 'Redaction'),
                  desc: L('返回体里的密钥替换成 [redacted:kind]', 'Replace secrets with [redacted:kind]'),
                  on: governance.redaction,
                  disabled: Boolean(busy),
                  onChange: (on) => setGovernance({ ...governance, redaction: on }),
                }),
                h(
                  'div',
                  { className: 'rk-row' },
                  h(
                    'div',
                    { className: 'rk-row-main' },
                    h('div', { className: 'rk-row-t' }, L('提示注入', 'Prompt injection')),
                    h(
                      'div',
                      { className: 'rk-row-d' },
                      L('检测工具返回里“改变模型行为”的指令', 'Detect instructions inside tool output'),
                    ),
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
                          className: governance.injection === value ? 'on' : '',
                          onClick: () => setGovernance({ ...governance, injection: value }),
                        },
                        label,
                      ),
                    ),
                  ),
                ),
                h(ToggleRow, {
                  key: 'sandbox',
                  title: L('沙箱拦截', 'Sandbox gate'),
                  desc: L(
                    '按文件/命令/网络规则拒绝调用；打开后可以真的挡住操作',
                    'Deny calls by file/command/network rules; this one can block work',
                  ),
                  on: governance.sandbox,
                  disabled: Boolean(busy),
                  onChange: (on) => {
                    const hasWorkspace = (state?.sandbox?.workspaces || []).length > 0
                    if (on && !hasWorkspace) {
                      setNote(
                        L(
                          '先配置工作区再打开沙箱，否则所有带路径的调用都会被拒绝。',
                          'Configure a workspace first — otherwise every path-bearing call is denied.',
                        ),
                      )
                      return
                    }
                    setGovernance({ ...governance, sandbox: on })
                  },
                }),
                note ? h('div', { className: 'rk-sub' }, note) : null,
              ]
            : h('div', { className: 'rk-empty' }, L('读取中…', 'Loading…')),
        ),

        h(
          Card,
          {
            title: L('沙箱与工作区', 'Sandbox and workspaces'),
            right: h(
              'button',
              { className: 'rk-btn primary', onClick: saveSandbox, disabled: !sandboxDirty || Boolean(busy) },
              L('保存', 'Save'),
            ),
          },
          h(
            'div',
            { className: 'rk-sub' },
            L(
              '工作区是路径判定的边界：没有工作区时沙箱开关会被拒绝打开。命令默认“允许”，危险前缀在规则里显式拦。',
              'A workspace is the boundary for every path decision. Without one the sandbox switch refuses to turn on. Commands default to allow; dangerous prefixes are denied by rule.',
            ),
          ),
          (draft?.workspaces || []).length
            ? h(
                'div',
                { style: { display: 'flex', flexDirection: 'column' } },
                ...(draft.workspaces || []).map((ws, index) =>
                  h(
                    'div',
                    { key: ws.profile, className: 'rk-row' },
                    h(
                      'div',
                      { className: 'rk-row-main' },
                      h('div', { className: 'rk-row-t' }, ws.profile),
                      h('div', { className: 'rk-row-d' }, ws.root + ' · ' + (ws.mode || 'workspace-write')),
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
              placeholder: L('profile', 'profile'),
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
              h('div', { className: 'rk-row-d' }, L('未命中规则时怎么办', 'What happens when no rule matches')),
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
              h('div', { className: 'rk-row-d' }, L('域名命中白名单/黑名单之外的默认行为', 'Behaviour for domains without a rule')),
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
                L(
                  '写/删之前留的副本；启动时按保留天数与上限清理',
                  'Copies kept before writes and deletes; pruned at startup by age and size',
                ),
              ),
            ),
            h(
              'div',
              { className: 'rk-sub' },
              (state?.trash?.files || 0) +
                L(' 个文件 · ', ' files · ') +
                fmtBytes(state?.trash?.bytes || 0) +
                ' · ' +
                L('保留 ', 'keep ') +
                (state?.trash?.retentionDays ?? 7) +
                L(' 天 / 上限 ', 'd / cap ') +
                (state?.trash?.maxMB ?? 256) +
                ' MB',
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
          (state?.trash?.recent || []).length
            ? h(
                'div',
                { style: { display: 'flex', flexDirection: 'column' } },
                ...(state.trash.recent || []).map((entry) =>
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
                      armed === entry.stamp + '/' + entry.file ? L('确认覆盖', 'Confirm overwrite') : L('恢复', 'Restore'),
                    ),
                  ),
                ),
              )
            : null,
          h(
            'div',
            { className: 'rk-sub' },
            L('基线', 'Mode') + ': ' + (sandbox.mode || '—') + ' · ' + L('审批', 'Approval') + ': ' + (sandbox.approval || '—') + ' · ' + L('规则数（文件/命令/网络）', 'Rules (file/cmd/net)') + ': ' + (sandbox.files || 0) + '/' + (sandbox.commands || 0) + '/' + (sandbox.network || 0),
          ),
        ),
        h(
          Card,
          { title: L('上下文治理', 'Context governance') },
          h(
            'div',
            { className: 'rk-row' },
            h(
              'div',
              { className: 'rk-row-main' },
              h('div', { className: 'rk-row-t' }, L('返回体裁剪', 'Tool-output truncation')),
              h(
                'div',
                { className: 'rk-row-d' },
                L('平台工具返回超过预算就切掉；只记账不改写', 'Cut platform tool output over budget; shadow only measures'),
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
          ),
          h(
            'div',
            { className: 'rk-row' },
            h(
              'div',
              { className: 'rk-row-main' },
              h('div', { className: 'rk-row-t' }, L('行投影', 'Line projection')),
              h(
                'div',
                { className: 'rk-row-d' },
                L('按工具限制展示行数，切掉的部分有标注', 'Cap displayed lines per tool; the cut is annotated'),
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
              h('div', { className: 'rk-row-t' }, L('单块预算', 'Budget per block')),
              h('div', { className: 'rk-row-d' }, L('按字节，最小 256', 'Bytes, 256 minimum')),
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
          truncStats.calls
            ? h(
                'div',
                { className: 'rk-sub' },
                L(
                  `已观测 ${truncStats.calls} 次 · 命中截断 ${truncStats.truncated} 次 · 累计省下 ${fmtBytes(
                    truncStats.savedBytes,
                  )} · 落盘 ${truncStats.spillFiles} 个文件`,
                  `observed ${truncStats.calls} · truncated ${truncStats.truncated} · saved ${fmtBytes(
                    truncStats.savedBytes,
                  )} · spilled ${truncStats.spillFiles}`,
                ),
              )
            : null,
          h(
            'div',
            { className: 'rk-grid' },
            h(Stat, {
              label: L('单次返回上限', 'Return cap'),
              value: context.maxReturnBytes ? `${context.maxReturnBytes} B` : '—',
            }),
            h(Stat, {
              label: L('字段投影', 'Field projection'),
              value: context.fieldsProjection ? L('开', 'on') : L('关', 'off'),
            }),
            h(Stat, {
              label: L('pruner / compaction', 'pruner / compaction'),
              value: `${context.prunerEnabled ? L('开', 'on') : L('关', 'off')} / ${
                context.compactionEnabled ? L('开', 'on') : L('关', 'off')
              }`,
            }),
            h(Stat, {
              label: L('延迟工具加载', 'Lazy tool loading'),
              value: context.lazyLoadTools ? L('开', 'on') : L('关', 'off'),
            }),
          ),
          h(
            'div',
            { className: 'rk-sub' },
            L(
              '上排是声明值，只作用于本插件自己的快路径/PTC；平台的工具返回是否被裁剪，取决于上方「返回体裁剪」开关。',
              'The four values above are declarations for this plugin’s own fast-path/PTC runs. Whether platform tool output gets cut is decided by the truncation switch above.',
            ),
          ),
          metrics.length
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
                      h('th', null, L('轮次', 'Turn')),
                      h('th', null, L('输入', 'In')),
                      h('th', null, L('输出', 'Out')),
                      h('th', null, L('工具返回字节', 'Tool bytes')),
                      h('th', null, L('工具调用', 'Calls')),
                      h('th', null, L('耗时', 'ms')),
                    ),
                  ),
                  h(
                    'tbody',
                    null,
                    metrics
                      .slice(-6)
                      .reverse()
                      .map((row, i) =>
                        h(
                          'tr',
                          { key: `${row.turn}-${i}` },
                          h('td', null, String(row.turn ?? '')),
                          h('td', null, String(row.inputTokens ?? 0)),
                          h('td', null, String(row.outputTokens ?? 0)),
                          h('td', null, String(row.toolResultBytesInContext ?? 0)),
                          h('td', null, String(row.toolCallsCount ?? 0)),
                          h('td', null, String(row.wallClockMs ?? 0)),
                        ),
                      ),
                  ),
                ),
              )
            : h(
                'div',
                { className: 'rk-empty' },
                L(
                  '还没有采样数据——只有经过本插件的快路径/PTC 执行才会产生。',
                  'No samples yet — they only come from this plugin’s own fast-path/PTC runs.',
                ),
              ),
        ),

        h(
          Card,
          { title: L('实测指标', 'Observed') },
          h(
            'div',
            { className: 'rk-grid' },
            h(Stat, { label: L('总调用', 'Calls'), value: observed.total ?? 0 }),
            h(Stat, { label: L('被拒绝', 'Blocked'), value: observed.blocked ?? 0 }),
            h(Stat, { label: L('需审批', 'Asked'), value: observed.asked ?? 0 }),
            h(Stat, { label: L('脱敏命中', 'Redacted'), value: observed.redacted ?? 0 }),
            h(Stat, { label: L('截断命中', 'Truncated'), value: observed.truncated ?? 0 }),
            h(Stat, { label: L('回收站副本', 'Trash copies'), value: (state?.trash && state.trash.files) || 0 }),
          ),
          (observed.top || []).length
            ? h(
                'div',
                { className: 'rk-chips' },
                ...observed.top.map((row) =>
                  h('span', { key: row.name, className: 'rk-chip' }, row.name + ' × ' + row.count),
                ),
              )
            : null,
          h(
            'div',
            { className: 'rk-sub' },
            L(
              '这些数字是从审计流水里数出来的（最近 200 条），不是估算；只统计经过本插件的调用。',
              'Counted from the audit log (last 200 entries), not estimated; only calls that passed through this plugin.',
            ),
          ),
        ),

        h(
          Card,
          { title: L('审计流水', 'Audit log') },
          audit.length
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
                    h('th', null, L('动作', 'Action')),
                    h('th', null, L('结果', 'Result')),
                    h('th', null, L('备注', 'Note')),
                  ),
                ),
                h(
                  'tbody',
                  null,
                  audit
                    .slice(-20)
                    .reverse()
                    .map((entry, i) =>
                      h(
                        'tr',
                        { key: `${entry.timestamp}-${i}` },
                        h('td', { className: 'rk-mono' }, stamp(entry.timestamp)),
                        h('td', { className: 'rk-mono' }, entry.tool),
                        h('td', null, entry.action),
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
            : h('div', { className: 'rk-empty' }, L('还没有调用记录。', 'No calls recorded yet.')),
        ),

        h(
          Card,
          { title: L('注册表', 'Registry') },
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
              ? registry.workspaces.map((ws) =>
                  h('span', { key: ws.profile, className: 'rk-chip' }, `${ws.profile} → ${ws.root}`),
                )
              : [h('span', { key: 'none', className: 'rk-empty' }, L('未注册', 'none registered'))]),
          ),
        ),
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
