# 变更记录 / Changelog

按版本倒序，每条注明「改了什么」和「为什么」。只写事实，不写宣传语。
Newest first. Each entry says what changed and why — facts, not adjectives.

Version sections are bilingual: `中文` then `English`.
从 0.5.0 起逐版记录；0.1.0–0.4.1 依据当时的提交补写。
Recorded version by version from 0.5.0; 0.1.0–0.4.1 reconstructed from their commits.

## 0.14.2 — 2026-11-11 · Documentation: bilingual changelog

**中文**
- 本文件改为中英双语，每条都有英文对照
- GitHub 上已发布的 20 个 Release 正文同步补上英文

**English**
- This file is now bilingual: every entry has an English counterpart
- The 20 existing GitHub releases were updated with the same English text

## 0.14.1 — 2026-11-11 · Documentation: changelog

**中文**
- 新增本文件，逐版记录从 0.1.0 到 0.14.0 的改动
- README 增加入口

**English**
- Added this file: the change from 0.1.0 through 0.14.0, one section per version
- README links to it

## 0.14.0 — 2026-11-11 · Per-switch impact, measured

**中文**
- 每个开关下面直接显示它实际做过什么：截断命中次数与节省字节、投影裁掉的行数、历史裁剪可回收与已省、拦截/询问次数、脱敏与注入命中
- 钩子层新增计数器：`redactions`、`injectionHits`、`projectedCalls`、`projectedLines`
- 目的：把「要不要开」的判断从读文档变成看一眼数字

**English**
- Every switch now shows what it has actually done: truncation hits and bytes saved, lines dropped by projection, reclaimable and saved bytes from pruning, blocked/asked counts, redactions and injection hits
- New hook counters: `redactions`, `injectionHits`, `projectedCalls`, `projectedLines`
- The point: deciding whether to turn something on becomes reading a number instead of reading docs

## 0.13.0 — 2026-11-11 · Page ordered by what each switch does to you

**中文**
- 页面按影响重排为三组：① 基础防护（无风险，默认开）② 上下文节省（改变输出）③ 沙箱保护（可能拒绝），每组带风险徽标
- 三个分散的保存按钮换成单一粘性保存条，出现时说明「有几处未保存」，并带「放弃」
- 顶部新增「套用推荐」：安全项全开，两个省 token 项设为观察，沙箱保持关闭
- 审计流水与注册表折叠到底部，常用数字留在顶部

**English**
- Three zones ordered by impact: 1) protection (safe, on by default) 2) context (changes output) 3) sandbox (can block), each with a risk badge
- Three scattered Save buttons replaced by one sticky bar that says how many changes are unsaved, with Discard
- Added "Recommended": turns on the safe set, puts both token savers in observe-only mode, leaves the sandbox off
- Audit log and registry collapsed to the bottom; the numbers people watch stayed at the top

## 0.12.0 — 2026-11-11 · Its own save button, a shorter audit list

**中文**
- 修复：上下文治理卡没有保存按钮，改完关面板即丢失（后端一直是好的，是 UI 缺按钮）
- 审计流水改为只看今天（默认 8 条，可展开全部今天），去掉与工具名重复的「动作」列
- 宿主侧新增 `auditToday` / `auditOlder`，按本机时区计算

**English**
- Fix: the context card had no Save button, so changes vanished when the panel closed (the backend was fine; the UI was missing a button)
- Audit log shows today only (8 rows by default, expandable), and the redundant Action column folded into the tool name
- The host now provides `auditToday` / `auditOlder`, computed in local time

## 0.11.0 — 2026-11-11 · History pruning, write mode

**中文**
- `governance.pruner.mode = on`：缩短旧工具返回的文本
- 安全约束：只替换字符串，不删消息、不删块、不改块类型；最近 `keepTurns` 轮不动；认不出结构则零改动
- 认两种形状：`role: 'tool'` 的字符串内容、`content` 数组里的 `tool-result` 块
- 默认仍是 `off`

**English**
- `governance.pruner.mode = on` shortens old tool-result text
- Safety rules: only strings are replaced; no message and no block is ever removed; the last `keepTurns` messages stay untouched; an unrecognised shape results in zero changes
- Two shapes handled: a `role: 'tool'` string body, and a `tool-result` block inside a `content` array
- Still `off` by default

## 0.10.0 — 2026-11-11 · Pruning observer, honest labels

**中文**
- `governance.pruner.mode = shadow`：只统计消息条数、角色分布、块类型与「只保留最近 N 轮能省多少」，绝不改写
- 页面上 `pruner / compaction` 与「延迟工具加载」改为「宿主负责」——此前显示「开」只表示配置值是 true
- schema 描述同步写明哪些字段在当前版本不生效

**English**
- `governance.pruner.mode = shadow` measures message count, role mix, block types and how much a keep-N-turns rule would reclaim — it never rewrites
- The page now says "host" for `pruner / compaction` and lazy tool loading; "on" before only meant the config value was true
- Schema descriptions state which fields have no effect in this version

## 0.9.0 — 2026-11-11 · Snapshot policy table, line projection

**中文**
- `sandbox.snapshotPolicy`：按工具声明参数里的路径字段，支持 `arguments.path` 与 `files[].path`；未登记的工具仍回落启发式
- `governance.projection`：按工具限制展示行数（整行裁剪，切点有标注），与按字节截断是两个维度

**English**
- `sandbox.snapshotPolicy` names the argument fields that hold paths, with dotted paths and `[]` arrays; tools without an entry still fall back to the heuristic
- `governance.projection` caps displayed lines per tool (whole lines, annotated cut) — a different axis from byte truncation

## 0.8.0 — 2026-11-11 · Audit retention, trash restore

**中文**
- 修复：`audit.retentionDays` 从未被使用——`Audit.cleanup()` 写好了但无人调用，现在安装时执行一次
- 回收站可恢复：每个时间戳目录写入 `.index.json` 记录原路径，页面列出最近 6 份
- 覆盖需二次确认（先返回 conflict，再点一次才写），避免覆盖是这类功能的初衷

**English**
- Fix: `audit.retentionDays` was never used — `Audit.cleanup()` existed with no caller; it now runs once at install
- Trash can restore: each stamp directory records original paths in `.index.json`, and the page lists the six most recent
- Overwriting needs a second click (conflict first, then confirm) — preventing accidental overwrites is the point

## 0.7.0 — 2026-11-11 · Trash keeps its own house

**中文**
- `sandbox.trashRetentionDays`（默认 7）与 `trashMaxMB`（默认 256），启动时按时间与总量清理
- 页面显示回收站文件数与占用，并提供「清空」
- 占用按真实 `stat` 统计，索引文件不计入

**English**
- `sandbox.trashRetentionDays` (7) and `trashMaxMB` (256); the bin is pruned at startup by age and size
- The page shows file count and size, and can clear it
- Usage is counted with real stats; index files are excluded

## 0.6.0 — 2026-11-11 · Snapshots before writes, realpath, trust

**中文**
- `backupEnabled` / `deletionProtection` 生效：写/删之前把目标文件复制到 `<stateDir>/trash/<时间戳>/`，8 MB 上限，失败不阻断
- 指标改为从审计流水派生（调用、拦截、脱敏、截断、回收站副本、最忙工具）
- `resolveAndValidate` 增加 realpath 校验：指向工作区外的 junction 即使字符串在根内也会被拒
- `workspaceTrust` 生效（未信任 = 只读），默认改为信任

**English**
- `backupEnabled` / `deletionProtection` work: before a write or delete the target is copied to `<stateDir>/trash/<stamp>/`, 8 MB cap, failures never block the call
- Metrics derive from the audit stream (calls, blocked, redacted, truncated, trash copies, busiest tools)
- `resolveAndValidate` gained a realpath check: a junction pointing outside the workspace is refused even when the string looks inside
- `workspaceTrust` is enforced (untrusted = read-only) and now defaults to trusted

## 0.5.0 — 2026-11-11 · P0: configurable sandbox

**中文**
- 工作区可配置，`verifyIsolation` 换成真实探测（不再谎报全通过）
- `sandbox.commandDefault`：未命中规则时的默认行为
- 沙箱开关前置于判定，无工作区时拒绝打开
- README 能力矩阵改为三态（✅ / ◐ / ✗），不再给未实现的能力打勾

**English**
- Workspaces are configurable, and `verifyIsolation` runs real probes instead of claiming everything passed
- `sandbox.commandDefault` decides behaviour when no rule matches
- The sandbox switch is checked before evaluation and refuses to turn on without a workspace
- The README matrix became three-state (✅ / ◐ / ✗); nothing unimplemented is ticked

## 0.4.1 — 2026-11-11 · Glob and version fixes

**中文**
- 沙箱路径匹配规范化分隔符：`secrets\key.txt` 与规则 `secrets/**` 之前永远匹配不上
- 健康检查的版本号改为从 `package.json` 读取，不再硬编码

**English**
- Sandbox path matching normalises separators: `secrets\key.txt` never matched a `secrets/**` rule before
- The health check reads the version from `package.json` instead of hard-coding it

## 0.4.0 — 2026-11-11 · Governance on platform tool calls

**中文**
- 上下文治理真正作用于平台工具调用（`tools/post-execute`），带开关

**English**
- Context governance actually runs on platform tool calls (`tools/post-execute`), behind a switch

## 0.3.3 — 2026-11-11 · Show context governance on the page

**中文**
- 页面展示上下文治理及其真实作用域

**English**
- The page shows context governance and its real scope

## 0.3.2 — 2026-11-11 · Drop the BOM

**中文**
- 去掉 `package.json` 的 BOM：BOM 会让插件管理器 `JSON.parse` 失败，整个插件被判为 missing

**English**
- Removed the BOM from `package.json`: it made the plugin manager's `JSON.parse` fail and the whole plugin was reported missing

## 0.3.1 — 2026-11-11 · Page at sidebar width

**中文**
- 页面适配侧栏宽度：标签换行、审计表不再被裁切

**English**
- The page fits the sidebar: labels wrap and the audit table is no longer clipped

## 0.3.0 — 2026-11-11 · First page

**中文**
- 第一个页面：治理开关、审计流水、注册表

**English**
- First page: governance switches, audit log, registry

## 0.2.0 — 2026-11-11 · Governance hooks

**中文**
- 治理钩子：审计、脱敏、注入检测、沙箱拦截

**English**
- Governance hooks: audit, redaction, injection detection, sandbox gate

## 0.1.1 — 2026-11-11 · Schema fix

**中文**
- 修复 `config.schema.json` 里一个缺失引号——整个文件不是合法 JSON

**English**
- Fixed a missing quote in `config.schema.json` that made the file invalid JSON

## 0.1.0 — 2026-11-10 · First release

**中文**
- 上下文治理、快路径模板、PTC、沙箱、审计；10 个 `runtime_kit_*` 斜杠命令

**English**
- Context governance, fast-path templates, PTC, sandbox, audit; ten `runtime_kit_*` slash commands
