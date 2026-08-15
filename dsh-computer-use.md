---
tags: [DeepSeek Harness, dsh, Computer Use, 插件开发, 项目书, harness-desktop]
description: dsh-computer-use 插件项目书——为 harness-desktop 打造"虚拟鼠标真人操作"的 Computer Use 能力
---

# 📋 dsh-computer-use 插件项目书

> 版本：v1.3 · 日期：2026-08-15 · 状态：🛠 开发中（P0-P3 完成；P4 集成已热生效，待 Windows 实测与发布）
> 修订：v1.1 Windows 跨平台适配；v1.2 开发实测记录；v1.3 P4 真实 web profile 集成完成（home patch 注入，HMR 热生效确认，当前 GUI 会话可直接调用插件工具）
> 关联：[[harness-desktop 项目]] · [[DeepSeek Harness 插件开发实操]] · [[DeepSeek Harness 插件生态]]

---

## 一、项目概述

### 1.1 项目名称
**dsh-computer-use** — DeepSeek Harness 的 Computer Use 插件

### 1.2 一句话定位
> 给 harness-desktop 增加"**虚拟鼠标真人操作**"能力：AI 生成一个独立光标，像人一样看屏幕、移动、点击、输入，替用户操作电脑。

### 1.3 用户需求（源自创始人）
- **虚拟鼠标**：独立的 Agent 光标，不抢真实光标、不打断用户
- **真人操作感**：光标移动动画、真实点击、看得见过程
- **视觉驱动**：看屏幕理解界面（游戏/Canvas 也能操作）
- **低成本**：尽量不烧视觉模型 token
- **跨平台**：macOS + Windows + Linux 一套搞定

---

## 二、市场与竞争分析

### 2.1 生态现状
dsh 插件生态 595+ 个（awesome-dsh-plugin），**Computer Use 类是 2026-08-13 突然爆发的赛道**（三天内涌入 10 个），但竞争格局尚未定型。

### 2.2 同行对比（实测数据 2026-08-15）

| 竞品 | ⭐ | 平台 | 路线 | 视觉grounding | 与我们的差异 |
|------|-----|------|------|:---:|-----------|
| **Anionex/dsh-computer-use** | 20 | 仅 macOS | AX语义优先 | ❌ 明确没做 | 我们跨平台 + 视觉双模 |
| ZRui-C/dsh-computer-use | 6 | macOS | Swift文本优先 | ❌ | 同上 |
| TideSparrow/computer-use-dsh | 2 | ? | Codex风格截图 | ✅ | 单薄 |
| geohotstan/dsh-computer-use | 2 | macOS | AX窗口 | ❌ | 同上 |
| ThreeBody6666/dsh-computer-use | 1 | Windows | 原生Win | ⚠️ | 我们跨平台 |
| xiaoheizi1212/dsh-computer-use | 1 | 多 | 隔离浏览器 | ⚠️ | 单薄 |
| zhengkx79-lab/dsh-computer-use-win | 1 | Windows | koffi FFI | ❌ | 我们跨平台 |
| h-nebula/dsh-computer-use-windows | 1 | Windows | 原生Win | ❌ | 同上 |
| haifeiWu/dsh-computer-use | 0 | macOS | +OCR | ⚠️ | 单薄 |
| alonelypigeon/dsh-plugin-desktop-control | 0 | ? | /desktop命令 | ❌ | 单薄 |

### 2.3 竞争结论
- ✅ **Anionex 占坑**"AX 语义安全操作"（macOS 专属）——我们不正面刚
- ✅ **空白位**："**跨平台 + 视觉真人操作**"——没人做
- ✅ **用户要的"虚拟鼠标真人操作"**正是 Anionex README 明确放弃的视觉 grounding 路线
- ⚠️ 风险：Anionex 更新活跃（8-15 还在推），需速度取胜

### 2.4 与 Hermes / Codex 对比（参考实现）

| 维度 | Hermes computer_use | Codex Computer Use | **我们的 dsh 插件** |
|------|--------------------|--------------------|--------------------|
| 底层引擎 | cua-driver | SkyComputerUseService（闭源）| cua-driver |
| 平台 | mac/win/linux | 仅 macOS | mac/win/linux |
| 操作模式 | AX编号+截图 双模 | 视觉驱动 | **AX+视觉 双模** |
| 光标 | 独立彩色光标 | 动画光标 | 独立彩色光标 |
| 宿主 | Hermes | Codex/ChatGPT | **dsh / harness-desktop** |
| 开源 | 文档开源 | 闭源 | ✅ 全开源 |

### 2.5 平台支持实测依据（2026-08-15 查证官方文档）

cua-driver 官方文档（Platform Support）确认 **Windows / macOS / Linux 三平台**，Windows 为 **Supported（正式支持）** 等级：

| 平台 | 支持等级 | 自动化技术栈 | 官方已验证覆盖 |
|------|---------|-------------|--------------|
| Windows | ✅ Supported | Win32 + UI Automation (UIA) + 原生输入 + 定向窗口消息 | Electron、Tauri、WPF、WinUI 3、WebView2 |
| macOS | ✅ Supported | AppKit + AX + Quartz/HID + ScreenCaptureKit | Electron、Tauri、AppKit、SwiftUI、WKWebView |
| Linux | ⚠️ 按窗口系统 | X11（Supported）/ Wayland（按合成器）| Sway 最全，GNOME 有限制 |

**关键利好**：宿主 harness-desktop 是 Electron，而 **Windows 上 cua-driver 的官方验证覆盖恰好包含 Electron** ——"插件跑在 harness-desktop 里操作 Windows 系统"这条链路，正处于官方已验证路径上。

---

## 三、技术选型

### 3.1 引擎：cua-driver v0.19.3 ✅
本机已装、权限已配（Accessibility + Screen Recording）、跨平台、MCP stdio 接口现成。

| 能力 | cua-driver 工具 | 对应"真人操作" |
|------|----------------|---------------|
| 看屏幕 | `get_desktop_state`（全屏截图）| 人眼观察 |
| 读界面结构 | `get_window_state`（AX树+坐标frame+截图）| 理解界面 |
| 生成虚拟鼠标 | `start_session`（专属彩色光标）| AI 的"手" |
| 点击 | `click(x,y)`（CGEvent 合成鼠标事件）| 真人点击 |
| 拖拽/滚动/输入 | `drag` `scroll` `type` `key` | 真人操作 |

### 3.2 弃选方案
- ❌ 自研原生 helper（Anionex 路线）：每平台一套代码，维护地狱
- ❌ Codex SkyComputerUseService：闭源、仅 macOS、不可嵌入
- ❌ 纯 AX 语义（Anionex）：游戏/Canvas 废，且非"真人操作"

### 3.3 视觉模型：可选（非必需）
- **默认模式 A（AX树）**：零视觉成本，纯文本读界面拿坐标
- **兜底模式 B（视觉）**：游戏/Canvas 才用截图+视觉模型（GLM-4V / zai 免费方案）

### 3.4 跨平台适配策略（AX / UIA 双树）

| 平台 | 界面树 | 我们的封装 |
|------|--------|-----------|
| macOS | AX（Accessibility）| `screen_observe` 统一输出"编号+坐标"抽象 |
| Windows | UIA（UI Automation）| 同上——平台差异消化在 `get_window_state` 之后 |

**原则：一份插件代码，三平台通用。** 平台差异只存在于引擎层（cua-driver 已封装），插件层无需感知是 AX 还是 UIA。

必须处理的差异：
1. **权限模型**：macOS 是 TCC（Accessibility + Screen Recording，本机已授权）；Windows 是 elevated-integrity 边界——**管理员权限窗口（UAC 弹窗、任务管理器等）无法操作**，引擎结构化拒绝而非静默失败
2. **平台专属工具**：`invoke_menu`（调菜单）、`launch_app`（后台启动）为 macOS 语义，Windows 上规避或走替代路径
3. **浏览器路线**：Chrome/Edge 在 Windows 上的操作覆盖最全；部分后台 Chromium 手势未证实，拒绝而非假装成功

---

## 四、架构设计

```
┌─ harness-desktop（Electron）──────────────────────┐
│  dsh 引擎                                         │
│   ┌─ dsh-computer-use 插件（我们写）───────────┐  │
│   │  Tools: screen_observe / computer_click    │  │
│   │         computer_type / computer_key        │  │
│   │         computer_scroll / computer_drag     │  │
│   │  Skill: /computer-use 加载后暴露工具         │  │
│   └──────────────┬─────────────────────────────┘  │
│                  │ MCP stdio                      │
│   ┌──────────────▼─────────────────────────────┐  │
│   │  cua-driver（引擎，跨平台）                 │  │
│   │  截图 / AX树 / 虚拟光标 / 鼠标键盘合成       │  │
│   └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

### 双模操作闭环（核心设计）

```
模式A（默认，零视觉成本）：
  screen_observe → AX树[element 5] 按钮"提交" @(800,450)
  → computer_click(element=5) → CGEvent点击
  → 再观察验证 ✓

模式B（视觉兜底，游戏/Canvas）：
  screen_observe(screenshot) → 视觉模型理解界面
  → 生成坐标 → computer_click(x=850, y=470)
  → 再截图验证 ✓

自动切换：AX 树为空（Canvas/游戏）时自动降级模式 B
```

---

## 五、工具集设计（模型友好，Hermes 风格）

| 工具 | 功能 | 对应 Hermes |
|------|------|------------|
| `screen_observe` | 截图+AX编号树（som 模式）| `capture(mode=som)` |
| `computer_click` | 点击（element/坐标）| `click` |
| `computer_double_click` | 双击 | `double_click` |
| `computer_right_click` | 右键 | `right_click` |
| `computer_type` | 文本输入 | `type` |
| `computer_key` | 快捷键 | `key` |
| `computer_scroll` | 滚动 | `scroll` |
| `computer_drag` | 拖拽 | `drag` |
| `computer_wait` | 等待/轮询 | `wait` |
| `app_list` | 列出应用 | `list_apps` |

---

## 六、开发方式（关键决策）

### 6.1 首选：让 harness 自己开发（Dogfooding）
利用 dsh 原生**自修改能力**（`@deepseek-ai/dsh-tool-cordis`）：

| 工具 | 功能 |
|------|------|
| `cordis_define` | agent 在运行时定义新插件（纯 JS 函数体）|
| `cordis_inspect_list/query` | 查询运行时 Service/Event/Tool schema |
| `cordis_run` | 运行刚定义的插件，即时生效 |
| `cordis_stop` / `cordis_undefine` | 停止/卸载，随时迭代 |

**分工**：
| 部分 | 谁做 |
|------|------|
| cua-driver 引擎 | 外部进程（已有，不动）|
| MCP 桥接配置 | cordis.yml / 动态定义 MCP client 实例 |
| 工具封装 + 安全护栏 + AX→坐标逻辑 | **harness 自己用 cordis_define 写** |
| 复杂原生 helper | 不需要（cua-driver 全包了）|

### 6.2 价值
- Dogfooding = 最好的产品演示（"AI 自己写插件扩展自己"）
- 即改即用，不重启不重建
- 符合创始人工作流（给执行方要求，不写具体代码）

---

## 七、实施路线（5 阶段 · 约 9.5 工作日）

| 阶段 | 内容 | 交付物 | 工时 |
|------|------|--------|------|
| **P0 验证** | dsh-mcp-client 接 cua-driver，headless 跑通 | 工具可调用 | 0.5天 |
| **P1 骨架** | 插件结构 + 精简工具集 + cordis.patch.yml + **AX/UIA 跨平台抽象层** | 可安装插件（跨平台就绪） | 2天 |
| **P2 双模闭环** | AX模式 + 视觉兜底 + 自动切换 | 真人操作demo | 3天 |
| **P3 安全** | 审批护栏 + 区域限制 + 敏感输入保护 | 安全版 | 2天 |
| **P4 发布** | harness-desktop 集成 + GitHub + dsh 生态发布 + **Windows 真机/SSH 冒烟验证** | 上线（双平台背书） | 2天 |

---

## 八、安全设计

1. **虚拟光标隔离**：独立 Agent 光标，不碰真实系统光标
2. **危险操作审批**：删除/支付/密码框 → 用户确认才执行
3. **会话级区域限制**：默认只允许操作工作区相关窗口
4. **敏感输入保护**：密码/密钥永不让模型接触
5. **过期状态拒绝**：观察结果有 TTL，过期必须重新观察（借鉴 Anionex）

---

## 九、风险与对策

| 风险 | 对策 |
|------|------|
| Anionex 迭代快 | 差异化在视觉+跨平台，不正面刚 AX 语义 |
| cua-driver license | MIT 开源，可嵌入 ✅ |
| dsh rc 期 API 变动 | 只依赖 mcp-client + tools 稳定接口 |
| 视觉模型成本 | AX 优先，视觉仅兜底，可配免费模型 |
| cordis_define 仅限纯 JS | 引擎部分用外部 cua-driver，逻辑部分纯 JS 正好 |
| Windows elevated-integrity 边界（UAC/管理员窗口不可操作） | 引擎结构化拒绝 + 文档明示，引导应用以普通权限运行 |
| 本机无 Windows 真机 | P4 用官方"SSH 驱动 Windows"指南冒烟验证 + 发布后社区实测 |

---

## 十、变现与引流

1. README 挂独立站 aibunkhouse.com
2. GitHub 发布 → dsh 插件生态（首个跨平台 Computer Use）
3. harness-desktop 内置 → 差异化卖点（"开箱即用的真人操作"）
4. 中文 + 国内用户市场（竞品全英文向）

---

## 十一、验收标准

- [x] P0：`dsh plugin add dsh-computer-use` 后工具可调用（隔离 profile 实测：headless + MCP stdio + 桥接全通）
- [x] P1：10 个模型友好工具全部注册成功（实际 11 个：+app_launch）
- [x] P2：demo 演示"打开应用 → 点击 → 输入"完整闭环（备忘录实测：启动→观察→点击→输入→验证五步通过）
- [x] P3：危险操作触发审批，密码框不可见（区域限制 fail-closed / 危险词审批 / 快照 TTL / 密码框保护实测通过）
- [x] P4：harness-desktop 集成（真实 web profile 已注册并经 HMR 热生效：当前 GUI 会话可直接调用插件工具；GitHub 发布待操作）
- [ ] 双平台（macOS + Windows）实测通过：Windows 上 Electron 宿主内完成"打开应用 → 点击 → 输入"闭环；管理员权限窗口按预期结构化拒绝（待 Windows 真机）
