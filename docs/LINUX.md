# Linux / Wayland 支持说明

本文记录本分支为 Linux（尤其是 Wayland 会话）做的改动、启用条件和已知边界。

## 1. 问题背景

`cua-driver` 在 Linux 上有两类输入通道：

| 通道 | X11 | Wayland |
|---|---|---|
| 按窗口后台投递 | XTEST / XInput2 主指针（可用） | **不存在**（合成器安全模型不允许） |
| 全局投递 | 同上 | libei（作用范围 = 合成器焦点） |

所以同一份代码在 X11 上「后台点击」可用，在 Wayland 上驱动会明确返回：

```json
{
  "code": "background_unavailable",
  "detail": "the requested target has no focus-free input backend",
  "escalation": { "recommended": "foreground" }
}
```

上游实现只对 `type_text` 允许升级到前台，点击 / 双击 / 右键 / 拖拽 / 滚动
在 Linux 上永远停留在后台模式，因此在 Wayland 会话里这几个工具直接不可用。

## 2. 本分支改了什么

### 2.1 坐标：截图帧 → 窗口逻辑像素

引擎的 `click` / `scroll` / `drag` 按**窗口逻辑像素**解释 `x,y`
（驱动内部按 `screen = 窗口原点 + x` 换算），但返回的 PNG 可能是 HiDPI 放大帧
（2x、1.5x），两者相差 `screenshotWidth / window_bounds.width` 倍。

在 2x 缩放的 GNOME 上实测：计算器窗口逻辑尺寸 360×616，截图帧 720×1232。
按截图像素 `(94, 873)` 点击，会被驱动理解为窗口内 `(94, 873)` —— 而窗口只有
616 高，点击直接落到窗口外，驱动报 `foreground_timeout`。

改动：

- `lib/observe.js`：快照额外保存 `window_bounds`；
- `lib/human.js`：新增 `windowScale()`，`windowLocalOf()` 按比例换算；
  `screenPointOf()` 同步换算，避免虚拟光标滑到两倍远；
- `lib/actions.js`：`drag` 的 `from/to` 四点同样换算；`scroll` 使用窗口中心作为落点。

**兼容性**：比例为 1 时（X11 常见）行为与旧版完全一致；比例异常（截图比逻辑小）
时不换算，避免把点击打偏。

### 2.2 投递模式：按平台能力升级前台

`lib/actions.js` 把 `supportsDeliveryMode` 的硬编码判断换成按平台的能力表：

```js
const FOREGROUND_TOOLS_BY_PLATFORM = {
  linux: new Set(['type_text', 'click', 'double_click', 'drag', 'scroll']),
  darwin: new Set(['type_text']),
}
```

- `win32`：保持历史行为（所有工具可升级）；
- `darwin`：保持保守策略，未改动；
- `linux`：放开点击类与滚动，否则 Wayland 下不可用。

### 2.3 截图上下文过期

前台投递要求引擎持有该窗口的截图上下文。快照放置一段时间后过期，驱动会返回
`capture_stale` / `screenshot_context_missing` / `window_never_read`。
本分支在这种情况下**只补一次** `get_window_state`（不重新解析无障碍树）后重试一次。

### 2.4 结构化拒绝不再被当成崩溃

驱动的"结构化拒绝"（`background_unavailable`、`foreground_timeout`、
`point_outside_window`……）是写进 **stdout 的 JSON + 非 0 退出码**。
原实现只在退出码为 0 时解析 stdout，因此这些拒绝会变成异常抛出，
上层的前台重试分支永远走不到。

`lib/cua.js` 现在会在非 0 退出时先尝试把 stdout 整体解析成 JSON 对象：
能解析就当结果返回（由 `engineRefusal` / `requiresForegroundRetry` 处理），
不能解析才按真实错误抛出。截断的 JSON 不会被半解析成结果。

### 2.5 安全边界没有放宽

升级前台仍然需要用户对**本次操作**授权（`allowed-once`）：

- 没有审批服务 → `foreground_approval_required`；
- 用户拒绝 → `foreground_approval_denied`，不切换焦点、不注入。

## 3. 在 GNOME Wayland 上启用

### 3.1 打开驱动的 Wayland 后端

Wayland 后端在 `cua-driver` 中默认关闭（opt-in）。用 systemd user drop-in 打开：

```ini
# ~/.config/systemd/user/dsh-computer-use-driver.service.d/wayland.conf
[Service]
Environment=CUA_DRIVER_RS_ENABLE_WAYLAND=1
```

```bash
systemctl --user daemon-reload
systemctl --user restart dsh-computer-use-driver
cua-driver call check_permissions   # 期望 "wayland_enabled": true
```

打开后 `list_apps` 才能枚举 Wayland 原生窗口，也能通过合成器直接抓窗口截图。

### 3.2 安装 GNOME Shell 辅助扩展

驱动自带 `wayland-helper/winrects@cua`，提供窗口几何、精确激活、合成器截图和
agent 光标。它运行在 shell 特权上下文，**不需要** portal 授权。

```bash
~/.cua-driver/packages/current/wayland-helper/install.sh
# GNOME 只在会话启动时扫描扩展，需要注销重登一次
gnome-extensions info winrects@cua   # 期望 状态: ACTIVE
```

没有它时驱动会拒绝前台注入（`foreground_unavailable`），这是防止输入打到错误应用的保护。

### 3.3 portal 授权（libei）

第一次前台投递会弹出 GNOME「远程桌面」授权框，需要打开「允许远程交互」并点「分享」。
勾选「记住该选择」后授权持久化到：

```
~/.local/share/flatpak/db/remote-desktop
```

删除该文件即可撤销。

## 4. 验证记录

环境：Ubuntu 26.04 / GNOME Shell 50.1 / Wayland，`cua-driver` 0.37.0。

| 能力 | 结果 |
|---|---|
| Wayland 原生窗口枚举 | ✅ |
| 合成器窗口截图 | ✅ 720×1232 |
| 无障碍（AT-SPI）元素点击 / 输入 | ✅ |
| 物理指针点击（前台） | ✅ 计算器显示区变为 `7` |
| 键盘注入（前台） | ✅ 文本进入编辑框 |
| 滚动（前台） | ✅ 内容滚动 |
| 坐标换算 | ✅ 截图 (94,873) → 逻辑 (47,437)，光标落点一致 |

## 5. 已知边界

- 后台投递在 Wayland 上**永远**不可用，每次像素级输入都会有一次前台升级；
  目标窗口会被激活（随后尽量恢复原焦点）。
- 合成器截图与无障碍树不同步时（动画、模态弹窗），仍需重新 `screen_observe`。
- KDE Plasma Wayland 目前缺少等价的窗口寻址适配器，不在本分支范围内。
