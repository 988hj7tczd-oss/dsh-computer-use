# dsh-computer-use 验证报告（VERIFICATION）

> 环境：macOS 15.6 (arm64) · harness-desktop（dsh 0.1.1-rc.2）· cua-driver 0.19.3
> 方法：隔离 profile（.dsh-p0）headless 实测，未改动真实 GUI 配置
> 日期：2026-08-15

## 最新维护验收（release candidate）

以下记录针对当前 main，而不是上方的历史 0.1.1-rc.2 报告：

| 项 | 结果 |
|---|---|
| DSH 0.1.2-rc.1 隔离宿主 | ✅ 在 `/tmp` 临时 DSH_HOME 中安装 DSH 0.1.2-rc.1 与插件 0.3.0（历史验证记录）；`--dump-config` 成功解析 `dsh-computer-use`，web profile 随机端口启动并返回 HTTP 响应，无 CallId/ToolCallId 模块链接错误 |
| 插件 runtime 脚本 | ✅ 真实 cua-driver 0.23.2，`node verify-runtime.mjs` 15/15 通过；覆盖工具注册、AX/native/zoom、图片块和结构化拒绝 |
| macOS GUI 闭环 | ✅ 当前插件代码 + cua-driver 0.23.2 操作系统 Calculator：AX 观察 135 个元素，点击 `1 + 2 =` 后截图确认显示 `3`，重新观察成功；`cmd+c` 路由也实际调用 |
| Windows 真实 GUI | ⛔ 本机无 Windows 10/11 测试环境，未将逻辑测试冒充 GUI 验收 |
| Linux 真实 GUI | ⛔ 本次未验证 |

Windows/Linux 在获得对应真实桌面环境并完成 `WINDOWS_TEST.md` / 等价验收前，不得标记为 fully tested。

## P0 — 引擎与桥接验证 ✅

| 项 | 结果 |
|---|---|
| cua-driver headless call | `get_screen_size`→1710×1112@1x；`get_cursor_position`；`list_apps`；`health_report` 全 pass |
| MCP stdio 链路 | `cua-driver mcp` 初始化 + `tools/list` 返回 **54 个工具** + `tools/call` 正常 |
| dsh-mcp-client 桥接 | 端到端：headless agent 真实调用 `mcp__cua__get_screen_size` 并正确报告 |

## P1 — 插件骨架与工具注册 ✅

| 项 | 结果 |
|---|---|
| 插件结构 | `cordis.patch.yml`（dsh.bundle.patch）+ `index.js` + `package.json`，bundle 机制加载成功 |
| 工具注册 | **11 个工具**全部注册（screen_observe / computer_click / double / right / type / key / scroll / drag / wait / app_list / app_launch） |
| screen_observe | harness-desktop 窗口：325 个编号元素，`[N] 角色 "标签" @(x,y)` 格式 |
| app_list | 返回 11 个运行中应用（含 pid/活动态） |

## P2 — 双模闭环 ✅（AX 模式实测通过）

备忘录完整 demo（"打开应用 → 点击 → 输入"验收项）：

| 步骤 | 工具 | 结果 |
|---|---|---|
| 打开 | `app_launch(bundle_id=com.apple.Notes, bring_to_front)` | ✅ 启动前置 |
| 观察 | `screen_observe(window=41812)` | ✅ 183 元素，锁定"新建备忘录"[46] |
| 点击 | `computer_click(element=46)` | ✅ 新建笔记成功 |
| 输入 | `computer_type(element=38, text=…)` | ✅ delivered=28，回读确认 |
| 验证 | `screen_observe(query=…)` | ✅ element 38 值=输入文本 |

视觉兜底（模式 B）：代码就绪（GLM-4V-Flash）；无 key 时优雅降级验证通过（AX 树照常返回 + 清晰提示），真实调用待 ZHIPU_API_KEY。

## P3 — 安全护栏 ✅

| 护栏 | 验证方式 | 结果 |
|---|---|---|
| 快照 TTL（历史会话） | 观察后等 16s 再点击 | ✅ 当时临时 patch 为 15 秒，拒绝："快照已过期"；当前代码与 bundle patch 默认 30 秒 |
| 无快照拒绝 | 直接动作 | ✅ 拒绝："请先调用 screen_observe" |
| 区域限制 | allowedApps=['备忘录']，操作 harness-desktop | ✅ 拒绝："不在允许操作列表"，fail closed |
| 放行路径 | allowedApps 含 harness-desktop | ✅ "收起侧边栏"点击成功 |
| 危险词检测 | 单元 12/12 | ✅ 删除/支付/转账/退出登录命中；保存/新建不误报 |
| 密码框保护 | 逻辑（AXSecureTextField 拒绝 type） | ✅ 代码验证，真实密码框待集成后补测 |

## 开发中发现并修复的真实 Bug

1. dsh-tools schema 不支持 `type:[x,'null']` 联合 → `oneOf`
2. output 多余字段被 `additionalProperties:false` 拒绝 → 精简 schema
3. object schema 缺 `additionalProperties` → 显式声明
4. **Safari AX 树序列化崩溃**（NaN 坐标 + 孤立代理项）→ `safeStr` + `centerOf` 有限性校验
5. `query` 参数声明未透传 → 修复
6. `app_launch` 的 `creates_new_instance` 未入 schema → 补全
7. **试用实测（真实 GUI 会话）**：`computer_key` 未传 pid/scope（press_key 报 Missing pid）→ 修复（有快照传 pid，否则 desktop scope）
8. **试用实测**：`computer_click` 坐标模式未传 window_id（多窗口应用报 ambiguous_window_target）→ 修复（坐标模式带 window_id）
9. **试用实测**：`computer_key` 传 pid 仍多窗口歧义 → 修复（补传 window_id；引擎验证通过 global_input/confirmed）
10. **试用实测（历史会话）**：TTL 15 秒对多步 UI 操作太短（计算器 19 次点击断链）→ 会话临时调 60 秒；当前代码层与 bundle patch 默认均为 30 秒，多步操作仍可显式调大 `ttlMs`。

## 🕹 真人操作模式（2026-08-15 核心改造）

**核心初衷落实**：AX 树只用于"看"（定位坐标），操作走像素级虚拟光标（滑行+点击，看得见过程）。

| 项 | 结果 |
|---|---|
| `lib/human.js` | 光标分段弧线滑行（模拟人手轨迹）+ 像素级点击 |
| `lib/actions.js` | click/双击/右键 全部改为真人操作（不再 AX 瞬发）|
| 快照增强 | 元素坐标 + 窗口位置（滑行定位）|
| 演示 | 彩虹光标弧线滑行到计算器（引擎直连验证滑行可见）；坐标校准为近似，待真实会话验证 |
| 光标主题 | 彩虹渐变（用户确认满意）|

## P4 — 真实环境集成 ✅（已热生效）

| 项 | 结果 |
|---|---|
| 集成方式 | home 级用户 patch 层（`$DSH_HOME/cordis.patch.yml`）注入，不修改任何 profile 配置 |
| install.sh | 执行成功：symlink 插件包 + 追加 home patch（幂等） |
| 合成验证 | `dsh --profile web --dump-config` 确认 `dsh-computer-use` 在合成树中 |
| **热生效** | **HMR 热加载确认：当前真实 GUI 会话可直接调用插件工具，screen_observe 返回格式与实现逐字段一致（含快照 ID 与提示语），无需重启** |
| 内置冲突排查 | 全 app 范围 grep：harness-desktop **无内置** computer_click/screen_observe 同名工具，纯新增无覆盖 |
| 卸载 | uninstall.sh |

## 🎨 虚拟光标主题（2026-08-15 新增）

| 项 | 结果 |
|---|---|
| 需求 | 彩色 + 渐变 + 动态渐变光标 |
| 生成器 | `tools/make_theme.py`：4 条纯色带拼渐变箭头（gf 渐变不被 bounded vector 支持 → 纯色带方案）+ 颜色关键帧动画（彩虹流动）|
| 主题 | `com.dsh.computeruse.rainbow`（128×128, 30fps, 12 动作动画）|
| 编译 | validate/build 通过（CuaDriver.app 内 cua-cursor-theme；CLI sidecar 缺失已绕过）|
| 安装/切换 | 已入库；会话 demo 实测 **用户确认满意** |
| 插件固化 | 动作绑定统一会话 `dsh-computer-use` + 启动自动 `set_agent_cursor_theme`（`cursorTheme` 配置项）|
| 踩坑 | Lottie 层变换必须是标准动画属性格式（`{"a":0,"k":...}`）；形状不能包 `gr` group；渐变 `gf` 不支持 |

## 已知边界（非缺陷）

- Safari 网页 DOM 不在 AX 树展开（引擎特性）→ 视觉兜底场景（native / vision 模式）
- 管理员权限窗口（UAC 等）Windows 上不可操作（引擎结构化拒绝）
- Windows/Linux 平台待真机实测（官方支持矩阵：Windows Supported）

## 📸 原生视觉模型接入（v0.2.0，2026-08-25 验证）

### harness 侧（dsh-src，已通过类型检查 + 154 项单测）

| 项 | 结果 |
|---|---|
| `llm-deepseek` 目录模型 `input` 字段 | `DeepSeekCatalogModel.input?: ['text'] \| ['text','image']`；`modelInfo()` 与 `resolveModel` 据此声明 `inputModalities` |
| 注册 `deepseek-v4-flash-vision-exp` | `DEFAULT_MODELS` 新增该模型（input: [text, image]），Web 模型选择器直接可见 |
| 图片块序列化 | `serialize.ts`：user 消息图片块 → OpenAI 兼容 `[{type:text},{type:image_url,url:data:...}]`（经 attachments 读回字节）；assistant/其他角色图片仍拒绝（UNSUPPORTED_CONTENT） |
| 附件字节解析 | adapter 注入 `resolveImageBytes`（`ctx.attachments.readImage`），无 attachment 服务时副作用明确报错 |
| 单测 | `serialize.spec` / `adapter.spec` / `dynamic-config.spec` 全部更新并通过（含图片块用例、3 模型默认目录断言）|

### 插件侧（dsh-computer-use，真实引擎闭环 12/12 ✅）

运行 `node verify-runtime.mjs`（隔离验证脚本，真实 cua-driver 0.21.0 daemon + 注入 attachments/llm 桩）：

| 项 | 结果 |
|---|---|
| 工具注册 | 12 个（新增 `screen_zoom`），`screen_observe` mode enum = ax/vision/native |
| `screen_observe(ax)` | 真实引擎：终端窗口树 + 坐标（截图像素标注）|
| native 拒绝 | text-only route（deepseek-v4-flash）→ 优雅提示切视觉模型 |
| **native 直读** | image-capable route（deepseek-v4-flash-vision-exp）→ 截图 PNG（1.06MB）经 attachments 落盘 + **render 产出 `{type:"image"}` 内容块（主模型直接看图）** |
| `screen_zoom` | 真实引擎 zoom：区域 JPEG（≤500px）落盘 + 图片块 |
| vision 降级链 | DeepSeek 观察者（无 key → MISSING_CREDENTIAL）→ GLM（无 key → 网络失败）→ 错误文本优雅返回，不崩溃 |
| 坐标语义 | 0.21.0 "窗口本地截图像素" 统一：移除旧 ×2 / 窗口偏移换算；输出标注"坐标=窗口本地截图像素" |
| 安全回归 | 无快照拒绝仍生效 |
| 引擎拒绝透传 | `{code, effect:"refused"}` 结构化拒绝 → `ok:false`（不再误报成功）|

### 说明

- native 直读的"模型真正看到图"依赖 harness 运行时（附带的 app 内嵌 dsh 需含上述 harness 改动；用 dsh-src 源码构建的 dsh CLI 直接具备）
- vision 观察者真实调用需 DEEPSEEK_API_KEY + 端点提供 `deepseek-v4-flash-vision-exp`
- 截图超附件限额（5MB）时自动用引擎 `zoom` 降级 ≤500px JPEG（`nativeImage: auto/full/compact` 可调）
