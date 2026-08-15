# dsh-computer-use 发布清单（PUBLISH）

> 状态更新：2026-08-15 · GitHub 发布已完成，npm 发布 + awesome 收录待做。

## ✅ 已完成：GitHub 发布（2026-08-15）

| 项 | 状态 |
|----|------|
| 仓库创建 | ✅ `https://github.com/988hj7tczd-oss/dsh-computer-use`（public）|
| 代码推送 | ✅ 21 个文件（22 减项目书）|
| description | ✅ 中文描述（Computer Use 插件：虚拟鼠标真人操作 for DeepSeek Harness…）|
| topics | ✅ `dsh-plugin` + `deepseek-harness` + `computer-use` + `cua-driver` + `ai-agents` |
| **dsh-plugin topic 收录** | ✅ **已出现在 https://github.com/topics/dsh-plugin 列表（最新更新排序第一条）** |
| license | ✅ MIT |
| ⚠️ 内部项目书 | ✅ 已从远程移除（`dsh-computer-use.md` 已加入 .gitignore）|

```bash
# 本地提交（供参考）
git init -b main
git add -A
git commit -m "feat: dsh-computer-use plugin — virtual mouse computer use"
git remote add origin https://github.com/988hj7tczd-oss/dsh-computer-use.git
git push -u origin main
```

## ⏳ 待做：npm 发布（dsh-market 安装途径）

> dsh-market（插件市场）安装插件**优先走 npm tarball**（比 GitHub 下载快）。`dsh plugin add <包名>` 从 npm 解析。npm 名称 `dsh-computer-use` **已验证可用**（404 = 未占用），npm 账号已登录（jerryweizhihao）。

```bash
cd /Users/Zhuanz/development/plugins/dsh-computer-use

# 1. 确保 package.json 的 files 字段完整（npm 只发布列出的文件）
#    files: ["index.js", "lib/", "tools/", "cordis.patch.yml", "README.md", "VERIFICATION.md", "LICENSE"]
#    ⚠️ 不要包含 dsh-computer-use.md（内部项目书）、.dsh-p0/、node_modules/

# 2. 本地打包预检（看包里有什么）
npm pack --dry-run

# 3. 发布（需要 npm 2FA/token；账号 jerryweizhihao 已登录）
npm publish --access public

# 4. 验证
npm view dsh-computer-use version
```

**发布后**：
- `dsh plugin --profile web add dsh-computer-use` 即可安装
- dsh-market 插件市场自动识别（registry-verified against repo 防抢注）

## ⏳ 待做：awesome-dsh-plugin 收录 PR

awesome 列表（2229⭐，dsh 官方精选）收录规则（2026-08-15 实测）：
> "PRs welcome — add one line under the matching category in both `README.md` and `README.zh.md`: `- [name](link) — one-line description`. Please also add the `dsh-plugin` topic to your repo so others can discover it."

**我们已经加了 dsh-plugin topic ✅**，还需：
1. Fork [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
2. 在 `README.md` 和 `README.zh.md` 的合适分类各加一行：
   ```markdown
   - [988hj7tczd-oss/dsh-computer-use](https://github.com/988hj7tczd-oss/dsh-computer-use) — 跨平台 Computer Use 插件：虚拟鼠标真人操作（AX 零视觉成本 + GLM 视觉兜底，安全护栏）
   ```
   放哪个分类？候选：`Tools & Capabilities` / `Development & Runtime` / 新增 `Computer Use` 分类
3. 提交 PR，等合并

## ✅ 已完成：独立站引流（aibunkhouse.com）（2026-08-15）

^- [x] 博客发一篇 dsh-computer-use 介绍文章（教程资源分类，ID 279，2212字）
^- [x] 工具页挂仓库链接（tools 表 + API 第5条 + featured）
^- [ ] README 挂 aibunkhouse.com（引流闭环）（待做：README 加独立站链接）

## Release 发布（可选）

```bash
git tag v0.1.0 && git push origin v0.1.0
# GitHub Releases 页面创建 v0.1.0，附 README 摘要 + VERIFICATION.md 链接
```

## ⚠️ 上传注意事项（已踩坑）

- [x] **`dsh-computer-use.md`（内部项目书）绝不能进公开仓库**——含竞争分析/变现策略/创始人语境。已加入 .gitignore ✅。**注意：git 历史仍含该项目书**（首次 commit 有），如需彻底清除需 `git filter-branch`/`filter-repo` 重写历史（公开仓库任何人可看历史版本，介意则立即处理）
- [x] `node_modules` 是符号链接，`.gitignore` 必须写 `node_modules`（不带 `/`）才能忽略符号链接
- [x] `.dsh-p0/`（隔离测试环境）已排除
- [x] 无硬编码密钥（ZHIPU_API_KEY 只读环境变量/文件）
