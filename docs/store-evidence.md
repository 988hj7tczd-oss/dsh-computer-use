# store-evidence — dsh-computer-use 一次性 Profile 安装 / 启动 / 卸载证据

本文件记录 DSH STORE 要求的一次性 Profile 安装、启动、卸载验证的证据与执行步骤。
**真实 Profile 运行**需在装有 DSH CLI 的宿主上执行（本仓库离线环境无法完成该步骤）；
以下同时记录已完成的离线等价证据，保证可复现、可审计。

## 1. 一次性 Profile 安装 / 启动 / 卸载步骤（在 DSH 宿主执行）

```bash
# 0) 前置：隔离环境（不触碰 ~/.dsh），确保 cua-driver 已安装并在 PATH 或 CUA_DRIVER_BIN 指定
export DSH_HOME=$(mktemp -d /tmp/dsh-cu-profile-XXXXXX)

# 1) 安装（方式 A：npm 包 / 本地目录均可）
npm install -g dsh-computer-use   # 或 dsh plugin --profile cu-demo add /path/to/dsh-computer-use

# 2) 启动冒烟：Profile 应正常启动；工具注册表出现
#    screen_observe / computer_click / computer_type / app_list 等 12 个工具
#    （会话内工具清单核对 + 读日志无 fatal/parse 错误）

# 3) 实机验证（可选，需图形会话）：screen_observe 返回 AX 树；computer_wait 无副作用
dsh --profile cu-demo "看一下当前打开的窗口"

# 4) 卸载
dsh plugin --profile cu-demo remove dsh-computer-use
#    Profile 重启后工具清单不再含 screen_observe / computer_*；DSH_HOME 临时目录可整体删除实现彻底卸载
rm -rf "$DSH_HOME"
```

## 2. 已完成的离线等价证据（本仓库内可复现，2026-08-26）

| 检查 | 命令 | 结果 |
|---|---|---|
| 语法检查 | `npm run check`（node --check 全 JS + bash -n install/uninstall.sh） | 0 错误 |
| 入口可加载 | `node -e "import('./index.js')"` | 成功（导出 name/inject/apply） |
| 工具注册面 | grep index.js `defineTool` | **12 个工具**：screen_observe / screen_zoom / computer_click / computer_double_click / computer_right_click / computer_type / computer_key / computer_scroll / computer_drag / computer_wait / app_list / app_launch |
| 安全护栏 | index.js `guard()` 统一包装 | 危险词审批、密码框保护、过期状态拒绝、作用域权限 |
| 权限面 | `PERMISSIONS.md` | spawn cua-driver（非 shell 固定 argv）；核心路径无业务文件读写；仅用户显式配置 GLM fallback 时读取指定 key 来源并向 Z.AI GLM API 发 HTTPS 请求；无 npm 生命周期脚本 |
| npm 包 | `npm pack` 内容核验 | files: index.js / lib/ / tools/ / cordis.patch.yml / README / VERIFICATION / PERMISSIONS.md / docs/ / LICENSE |

## 3. STORE 五信号响应行

| 信号 | 响应 |
|---|---|
| 规范仓库（canonical repository） | package.json `repository` → `git+https://github.com/988hj7tczd-oss/dsh-computer-use.git`（与仓库一致） |
| Node 兼容性声明 | `engines.node >= 22.18.0` + `dsh.compatibility.node` |
| 供应链审查 | 依赖仅 `@deepseek-ai/dsh-tools` + `@deepseek-ai/schemastery`（官方生态）；无 runtime/optional 第三方依赖；peer 层面无 |
| 文件权限信号 | 有 `spawn` 子进程（cua-driver）——真实插件核心能力；GLM fallback 仅读取用户显式指定的 key 文件，不写文件 |
| 命令权限信号 | `spawn` 固定 argv、`shell: false`、无 `exec`/`eval`/`shell: true` |

## 4. 验证脚本

仓库内 `verify-runtime.mjs`（检测 cua-driver 存在性 + 版本 + 观测通道健康检查）可作为安装后自检入口。