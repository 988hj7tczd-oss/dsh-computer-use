# dsh-computer-use GitHub 发布清单

> P4 发布步骤（待用户操作；本机无 GitHub 凭据/远程仓库）。

## 1. 本地 git 初始化与提交

```bash
cd /Users/Zhuanz/development/plugins/dsh-computer-use
git init
git add -A          # .gitignore 已排除 .dsh-p0/ 与 node_modules/
git commit -m "dsh-computer-use: Computer Use 插件（P0-P4 完成，11 工具，跨平台）"
```

## 2. 创建远程仓库并推送

```bash
# GitHub 新建仓库 dsh-computer-use（public）
git remote add origin git@github.com:<your-name>/dsh-computer-use.git
git branch -M main
git push -u origin main
```

## 3. Release 发布

- 打标签：`git tag v0.1.0 && git push origin v0.1.0`
- GitHub Releases 页面创建 v0.1.0，附：
  - README 摘要（能力表 + 安全设计）
  - VERIFICATION.md 链接（实测证据）
  - 安装说明（install.sh / uninstall.sh）

## 4. dsh 生态发布（项目书 2.1）

- awesome-dsh-plugin 提交 PR（项目：跨平台 Computer Use，首个）
- 差异化卖点文案（中文向）：
  - 跨平台（macOS/Windows/Linux，官方支持矩阵背书）
  - 纯 AX 模式零视觉成本 + 可选视觉兜底（GLM-4V-Flash 免费）
  - 安全护栏（快照 TTL / 区域限制 / 危险审批 / 密码框保护）
  - 虚拟光标隔离，不抢真实鼠标

## 5. 发布前自检

- [x] `bash -n install.sh uninstall.sh`（脚本语法）
- [x] 代码语法：node --check 全部 js（CI 已自动化：`.github/workflows/ci.yml`）
- [x] README 与实际行为一致（工具名/参数/配置）
- [x] VERIFICATION.md 与实测记录一致
- [x] package.json 元数据（name/version/license/keywords/files/scripts）
- [x] 引擎二进制默认走 PATH（`CUA_DRIVER_BIN` 可覆盖），无硬编码用户路径
- [x] 光标主题产物 `theme.lottie` 已入库，README 含安装说明

## 6. 上传注意事项（git add 前）

- [ ] `git add` 时**排除 `dsh-computer-use.md`**（内部项目书，含竞争分析/变现策略/创始人语境，不宜公开）——用 `git add` 逐个添加，或 `git rm --cached dsh-computer-use.md` 后加入 .gitignore
- [ ] 确认 `theme.lottie`、`.github/` 已加入版本控制
- [ ] 首次推送前 `git status` 复核没有 `.dsh-p0/`、`node_modules/`、密钥文件
