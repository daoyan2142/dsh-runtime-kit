# 发布 dsh-runtime-kit 到 dsh market

dsh market（dshmarket / 插件发现页）的插件列表来自精选列表
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。
收录流程 = **GitHub 仓库 + 一个 PR**（在列表仓库的 `data/plugins/` 加一个 YAML 文件）。
合并后站点与 dsh market 通常一天内自动收录。

## 前置检查（已就绪 ✅）

| 项 | 状态 |
|---|---|
| `dsh.bundle` 清单（package.json + patch.yml 含 `- insert:` 行） | ✅ 已声明，CI 会核对 |
| 真实可用代码（dist + src + 47 项冒烟测试 + 集成探测） | ✅ |
| npm 包名 `dsh-runtime-kit` | ✅ 可用（registry.npmmirror 查询 404） |
| `repository` 字段指向列表收录的仓库 | ✅ 已配置（npm↔列表关联需要） |
| 描述属实（无营销词，数字与代码一致） | ✅ 已逐条核对 |
| 仓库 ≥ 1 天（CI 自动检查） | ⏳ 建仓后需等待 |

## 步骤

### 0. 启动本地代理

git 需要走本地代理才能访问 GitHub（端口按你的代理软件实际监听为准）。
启动你的代理软件后 GitHub 才可达。验证：

```powershell
git ls-remote https://github.com/awesome-dsh-plugin/awesome-dsh-plugin HEAD
```

### 1. 创建 GitHub 仓库并推送代码

- 在 GitHub 创建**公开**仓库 `daoyan2142/dsh-runtime-kit`（不要初始化 README）
- 为仓库添加 topic：**`dsh-plugin`**（CI 要求）
- 推送本地代码：

```powershell
cd <本地仓库目录>
git init -b main
git add -A
git commit -m "dsh-runtime-kit 0.1.0: context governance, fast path, PTC, sandbox, audit"
git remote add origin https://github.com/daoyan2142/dsh-runtime-kit.git
git push -u origin main
```

### 2. 等待 ≥ 1 天

CI 会自动检查仓库年龄（过滤"投稿前几分钟才建"的仓库）。不足一天时投稿会被
`Submission gate` 挡下，几小时后自动重新判定，无需空提交重触发。

### 3.（可选，推荐）发布 npm 包

预构建安装免 `allowBuilds` 构建授权，且市场会展示下载量。
**注意 registry 指向**：本机 `.npmrc` 是 npmmirror（仅镜像拉取），发布必须指向官方源：

```powershell
npm login --registry https://registry.npmjs.org
npm publish --registry https://registry.npmjs.org
```

发布后无需任何通知——npm↔列表映射由 registry 自动采集（`repository` 字段已指回本仓库）。
不发 npm 也完全不影响收录，只是没有下载量数字。

> 备选：不发 npm 也可以把预构建 tarball 挂到 GitHub Release 并在投稿 YAML 里加
> `tarball: https://github.com/daoyan2142/dsh-runtime-kit/releases/latest/download/dsh-runtime-kit.tgz`
> （资产名不要带版本号，否则下次发版即 404）。

### 4. 提 PR 到 awesome-dsh-plugin 列表

1. Fork 仓库 `awesome-dsh-plugin/awesome-dsh-plugin`
2. 在 fork 中新建文件 **`data/plugins/daoyan2142__dsh-runtime-kit.yml`**
   （内容就是本仓库 [publish/data/plugins/daoyan2142__dsh-runtime-kit.yml](publish/data/plugins/daoyan2142__dsh-runtime-kit.yml) 的原文）
3. 打开 PR，建议内容：

> **标题：** Add daoyan2142/dsh-runtime-kit
>
> **正文：**
> Adds `dsh-runtime-kit`, a fast-execution runtime for dsh (context governance, zero-LLM fast path, PTC container scripts, three-tier sandbox, append-only audit).
>
> - [x] `dsh.bundle` manifest declared (`package.json` + `patch.yml`)
> - [x] Real, working code (bundled runtime + 47 smoke tests + live integration probe)
> - [x] Category: `dev` (Development & Runtime)
> - [x] Description verified against the code (10 `runtime_kit_*` commands, 4 KB default cap)
> - [x] Repo has the `dsh-plugin` topic

注意事项（来自贡献指南）：

- **只加这一个文件**，不要改两个 README（它们由脚本生成）；一个 PR 最多 3 条
- 描述含 `: `（冒号+空格）必须加引号——投稿 YAML 已按此格式写好
- 分类按实际功能选：本插件是运行时基础设施，`dev` 最贴切
- 评审会实际读仓库代码核对描述；被要求修改时打 `held: author` 标签，
  同分支推送修复 + 留一条评论说明即可

### 5. 收录生效

PR 合并后 README 与站点自动重建，通常 1 天内：
- 目录站页面：`https://awesome-dsh-plugin.com/p/daoyan2142/dsh-runtime-kit/`
- dshmarket 市场卡片自动出现；安装命令：
  - 有 npm：`dsh plugin --profile web add dsh-runtime-kit`
  - 仅 GitHub：`dsh plugin --profile web add github:daoyan2142/dsh-runtime-kit`
- dsh 0.2.1+ 插件发现页（索引源 `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`）同步可搜

## 可选增强

- **图标**：在投稿 YAML 加 `icon:`（GitHub 托管的方形 png/jpg/webp，约 96px 显示）
- **截图**：仓库根放 `screenshots.json`（1–8 张，相对路径），市场详情页 App Store 式展示
