#!/usr/bin/env python3
"""
dsh-computer-use 光标主题生成器 v2 —— 彩虹渐变箭头
dotLottie 主题：128x128, 30fps, 12 个动作动画。
渐变实现：箭头主体由 4 条纯色带拼接（左上→右下渐变），每条色带颜色做
关键帧动画（彩虹流动）= "动态渐变"。白色描边保证任意背景下可见。

用法:
  python3 tools/make_theme.py --output theme.lottie    # 生成主题产物（仓库根目录已附带）

安装（使插件默认 cursorTheme 生效）:
  主题需先经 cua-driver 的 cursor-theme 编译器安装（"已安装的主题"才可被
  set_agent_cursor_theme 选择）。编译器随引擎提供（CLI sidecar: cua-cursor-theme，
  macOS 亦在 CuaDriver.app 内），命令与安装位置见 cua-driver 官方文档
  (https://github.com/trycua/cua)。
  未安装主题时插件启动自动回退引擎默认光标，不影响任何功能。
"""
import json, zipfile, argparse

W, H, FPS = 128, 128, 30

# 箭头外轮廓（经典指针，热点在尖端 (16,16)）
# 顺序：尖端 → 右上翼 → 右侧内凹 → 右下尾 → 左侧内凹 → 左下翼
ARROW = [
    (16, 16),   # 尖端
    (52, 30),   # 右上翼
    (38, 40),   # 右侧内凹
    (58, 70),   # 右下尾
    (30, 58),   # 左侧内凹
    (16, 52),   # 左下翼
]

# 4 条色带的彩虹色（RGB 0-1），各自随时间流动
BAND_COLORS = [
    [0.25, 0.55, 1.0],   # 蓝
    [0.55, 0.30, 1.0],   # 紫
    [1.0, 0.30, 0.45],   # 粉红
    [1.0, 0.75, 0.20],   # 橙
]

def lerp(a, b, t):
    return (a[0] + (b[0]-a[0])*t, a[1] + (b[1]-a[1])*t)

def arrow_edges():
    """返回箭头上下边缘的顶点序列（用于切色带）。按 x 排序。"""
    pts = sorted(ARROW, key=lambda p: (p[0], p[1]))
    return pts

def band_polygon(x0, x1):
    """在 [x0,x1] 区间构造一条竖直色带（四边形），上下边界贴合箭头轮廓。"""
    # 简化：用箭头顶点的包络（上边缘：尖端→右上翼→右下尾；下边缘：尖端→左下翼→…）
    # 上轮廓：x 从小到大取最上点；下轮廓：取最下点
    # 用线性插值在 x0/x1 处求上下 y
    def upper_y(x):
        # 尖端(16,16)→右上翼(52,30) 线段
        if x <= 52: return lerp((16,16),(52,30), (x-16)/36)[1]
        return lerp((52,30),(58,70), (x-52)/6)[1]
    def lower_y(x):
        # 尖端(16,16)→左下翼(16,52)→左侧内凹(30,58)→右下尾(58,70)
        if x <= 30: return lerp((16,52),(30,58), (x-16)/14)[1]
        return lerp((30,58),(58,70), (x-30)/28)[1]
    x0c, x1c = max(16, x0), min(58, x1)
    if x1c <= x0c: return None
    return [(x0c, upper_y(x0c)), (x1c, upper_y(x1c)), (x1c, lower_y(x1c)), (x0c, lower_y(x0c))]

def poly_path(pts):
    """构造 Lottie 多边形路径（直线边）。"""
    v = [[float(x), float(y)] for x, y in pts]
    i = [[0.0, 0.0] for _ in pts]
    o = [[0.0, 0.0] for _ in pts]
    return {"a": 0, "k": {"i": i, "o": o, "v": v, "c": True}}

def animated_color(rgb, shift, frames):
    """颜色关键帧：给定基色+相位偏移，在彩虹色环上流动。"""
    base = rgb
    keys = []
    steps = 4
    for i in range(steps + 1):
        t = int(frames * i / steps)
        # 颜色流动：基色 + 相位偏移循环
        phase = (i + shift) % 4
        c = BAND_COLORS[phase]
        keys.append({"t": t, "s": [c[0], c[1], c[2], 1.0]})
    return {"a": 1, "k": keys}

def shape_layer(name, frames, anim_type='idle', ind=1):
    """指针层：4 条色带拼箭头 + 白色描边。anim_type 控制动作变换。"""
    # 动作变换（标准 Lottie 动画属性格式）
    p = {"a": 0, "k": [64, 64, 0]}
    s = {"a": 0, "k": [100, 100, 100]}
    r = {"a": 0, "k": 0}
    o = {"a": 0, "k": 100}
    if anim_type == 'idle':
        p = {"a": 1, "k": [{"t": 0, "s": [64, 58, 0]}, {"t": int(frames/2), "s": [64, 70, 0]}, {"t": frames, "s": [64, 58, 0]}]}
    elif anim_type == 'click':
        s = {"a": 1, "k": [{"t": 0, "s": [100,100,100]}, {"t": int(frames*0.3), "s": [80,80,100]}, {"t": frames, "s": [100,100,100]}]}
        o = {"a": 1, "k": [{"t": 0, "s": 100}, {"t": int(frames*0.4), "s": 55}, {"t": frames, "s": 100}]}
    elif anim_type == 'drag':
        p = {"a": 1, "k": [{"t": 0, "s": [48, 64, 0]}, {"t": frames, "s": [80, 64, 0]}]}
    elif anim_type == 'navigate':
        p = {"a": 1, "k": [{"t": 0, "s": [42, 64, 0]}, {"t": frames, "s": [86, 64, 0]}]}
    elif anim_type == 'scroll':
        p = {"a": 1, "k": [{"t": 0, "s": [64, 72, 0]}, {"t": frames, "s": [64, 56, 0]}]}
    elif anim_type in ('text', 'key'):
        o = {"a": 1, "k": [{"t": 0, "s": 100}, {"t": int(frames*0.5), "s": 40}, {"t": frames, "s": 100}]}
    elif anim_type == 'observe':
        s = {"a": 1, "k": [{"t": 0, "s": [100,100,100]}, {"t": int(frames/2), "s": [114,114,100]}, {"t": frames, "s": [100,100,100]}]}
    elif anim_type == 'transfer':
        o = {"a": 1, "k": [{"t": 0, "s": 100}, {"t": int(frames*0.5), "s": 0}, {"t": frames, "s": 100}]}
    elif anim_type == 'record':
        s = {"a": 1, "k": [{"t": 0, "s": [100,100,100]}, {"t": int(frames/2), "s": [118,118,100]}, {"t": frames, "s": [100,100,100]}]}
    elif anim_type in ('app', 'system'):
        r = {"a": 1, "k": [{"t": 0, "s": -8}, {"t": int(frames/2), "s": 8}, {"t": frames, "s": -8}]}

    # 4 条色带（x 从 16 到 58，切成 4 段）
    shapes = []
    seg_w = (58 - 16) / 4
    for i in range(4):
        poly = band_polygon(16 + i*seg_w, 16 + (i+1)*seg_w)
        if poly is None: continue
        shapes.append({"ty": "sh", "nm": f"band{i}", "ks": poly_path(poly)})
        shapes.append({"ty": "fl", "nm": f"fill{i}",
                       "c": animated_color(BAND_COLORS[i], i, frames),
                       "o": {"a": 0, "k": 100}})
    # 白色描边（外轮廓：用整个箭头的四边形近似——用最外两点）
    shapes.append({"ty": "st", "nm": "outline",
                   "c": {"a": 0, "k": [1, 1, 1, 1]}, "o": {"a": 0, "k": 100},
                   "w": {"a": 0, "k": 2.5}, "lc": 2, "lj": 2})

    return {
        "ty": 4, "nm": name, "ind": ind, "ip": 0, "op": frames, "st": 0, "sr": 1,
        "ks": {"o": o, "r": r, "p": p, "a": {"a": 0, "k": [0, 0, 0]}, "s": s},
        "shapes": shapes,
    }

ACTIONS = ['idle', 'observe', 'click', 'drag', 'scroll', 'text', 'key', 'navigate',
           'app', 'transfer', 'record', 'system']

def make_animation(action, frames=30):
    return {
        "v": "5.7.0", "fr": FPS, "ip": 0, "op": frames, "w": W, "h": H,
        "nm": f"cursor-{action}", "ddd": 0, "assets": [],
        "layers": [shape_layer('pointer', frames, anim_type=action, ind=1)],
    }

def make_dotlottie(out_path):
    manifest = {
        "version": "1.0", "generator": "dsh-computer-use",
        "author": "dsh-computer-use",
        "animations": [{"id": a, "playMode": "normal"} for a in ACTIONS],
    }
    theme = {
        "schema": "cua.cursor-theme/2",
        "id": "com.dsh.computeruse.rainbow",
        "name": "彩虹渐变指针",
        "version": "1.0.0",
        "author": "dsh-computer-use",
        "license": "MIT",
        "compatibility": {"profile": "cua-driver-actions-v2", "semantics": 2},
        "canvas": {"width": W, "height": H, "fps": FPS},
        "hotspot": {"x": 16, "y": 16},
        "actions": {a: {"animation": a, "still_frame": 0} for a in ACTIONS},
    }
    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json', json.dumps(manifest, indent=1))
        z.writestr('cua/theme.json', json.dumps(theme, indent=1))
        for a in ACTIONS:
            z.writestr(f'a/{a}.json', json.dumps(make_animation(a), separators=(',', ':')))
    print(f'[ok] 生成 {out_path}')

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--output', default='theme.lottie')
    args = ap.parse_args()
    make_dotlottie(args.output)
