"""对比 Windows 四种系统背景材质在纯色底图上的染色强度。

用法（在项目根目录）：python tools/measure_material.py
结论用途：选一个"染色最淡"的材质，才能让玻璃完全透明的同时保留模糊。
"""
import json
import os
import subprocess
import time

from PIL import ImageGrab

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ELECTRON = os.path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
BACKDROP_COLOR = (51, 102, 204)


def spawn(args, extra_env=None):
    env = dict(os.environ)
    env.pop('ELECTRON_RUN_AS_NODE', None)
    if extra_env:
        env.update(extra_env)
    return subprocess.Popen(args, cwd=ROOT, env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def grab():
    return ImageGrab.grab(all_screens=True).convert('RGB')


def main():
    with open(os.path.join(ROOT, 'data', 'config.json'), encoding='utf-8') as f:
        bounds = json.load(f)['ui']['windowBounds']
    left, top = bounds['x'], bounds['y']
    print(f'窗口位置：{left},{top} {bounds["width"]}x{bounds["height"]}')

    backdrop = spawn([ELECTRON, 'tools/glass_backdrop/main.js'])
    time.sleep(4)
    bg = grab().getpixel((300, 260))
    print('底图色：', bg)
    if abs(bg[0] - BACKDROP_COLOR[0]) > 12:
        print('！底图没起来，结果不可信')
        backdrop.terminate()
        return

    # 窗口内三个固定相对点：侧栏空白 / 内容区空白 / 卡片
    probes = {'侧栏': (80, 620), '内容区': (700, 700), '卡片': (420, 250)}
    rows = []

    for mat in ['acrylic', 'mica', 'tabbed', 'none']:
        proc = spawn([ELECTRON, '.'], {'SAIGUI_MATERIAL': mat})
        time.sleep(5.5)
        im = grab()
        im.save(os.path.join(ROOT, 'docs', 'shots', f'mat-{mat}.png'))
        vals = {}
        for name, (dx, dy) in probes.items():
            vals[name] = im.getpixel((left + dx, top + dy))
        # 相对底图的提亮量（用亮度差当"白膜强度"）
        avg = sum(v[0] + v[1] + v[2] for v in vals.values()) / (3 * len(vals))
        base = sum(bg) / 3
        rows.append((mat, vals, round(avg - base, 1)))
        proc.terminate()
        proc.wait()
        time.sleep(1.5)

    backdrop.terminate()
    print('\n材质          侧栏              内容区            卡片              提亮量(越小越透)')
    for mat, vals, lift in rows:
        print(f'{mat:12s} {str(vals["侧栏"]):18s}{str(vals["内容区"]):18s}{str(vals["卡片"]):18s}{lift}')


if __name__ == '__main__':
    main()
