# Windows 双平台冒烟验证指南

> 目标：验证 dsh-computer-use 在 Windows 上完成"打开应用 → 点击 → 输入"闭环。
> 无 Windows 真机时，可用 cua-driver 官方的 "Drive a Windows app over SSH" 方案远程驱动。

## 前置

- Windows 10/11（普通用户权限运行 harness/cua-driver；**管理员权限窗口不可操作**，属引擎既定边界）
- cua-driver Windows 版已安装（官方支持：Win32 + UIA，已验证 Electron/Tauri/WPF/WinUI 3/WebView2）
- harness-desktop（Windows 版）已装，`install.sh` 完成插件注册

## 冒烟步骤（headless，可脚本化）

1. **引擎连通**：`cua-driver call get_screen_size '{}'` 返回分辨率
2. **插件加载**：`dsh --profile web --dump-config` 含 `dsh-computer-use`
3. **闭环 demo**（headless prompt）：
   ```
   1) app_list 列出应用
   2) app_launch 打开"记事本"(notepad.exe, bring_to_front)
   3) screen_observe 观察（UIA 树）
   4) computer_click 点击编辑区（element 编号）
   5) computer_type 输入 "hello dsh-computer-use"
   6) screen_observe 验证文本已输入
   ```
4. **边界验证**：
   - 尝试操作管理员窗口（任务管理器/已提升的 cmd）→ 应结构化拒绝而非静默成功
   - 危险词按钮（删除/支付）→ 触发审批
   - 快照 TTL：等 16s 后操作 → 被拒

## 无真机时的 SSH 冒烟

cua-driver 官方文档 "Drive a Windows app over SSH"：
- 在 Windows 目标机配置 OpenSSH Server
- 从本机 `ssh <user>@<win-host>` 执行上述 cua-driver call（远程进程持有 Windows 会话）
- 验证工具调用链路；完整 GUI 交互仍建议真机最终验收

## 通过标准（对应项目书验收）

- [ ] Windows 上 Electron 宿主（harness-desktop）内完成打开→点击→输入闭环
- [ ] 管理员权限窗口按预期结构化拒绝
- [ ] AX/UIA 统一抽象（screen_observe 编号 + 坐标）在 Windows 表现与 macOS 一致
