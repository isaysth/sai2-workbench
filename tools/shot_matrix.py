"""外观矩阵验收：4 套风格/明暗 × 3 种背景，逐格系统级截屏并采样像素。

为什么用系统截屏而不是 capturePage：
  桌面模式下窗口是真透明的，页面本身什么都没有，只有系统合成后的画面才看得出
  "有没有真的透出去"。capturePage 只能拍到页面自绘的那一层。

每轮都 taskkill 重建进程：Electron 的窗口残留会让下一轮的截图叠上鬼影。
"""

import json
import math
import os
import subprocess
import time

from PIL import Image, ImageDraw, ImageGrab

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ELECTRON = os.path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
CFG = os.path.join(ROOT, 'data', 'config.json')
SHOTS = os.path.join(ROOT, 'docs', 'shots')
BACKGROUNDS = os.path.join(ROOT, 'data', 'backgrounds')
TEST_BG = 'bg-matritest.png'


def killall():
    subprocess.run(['taskkill', '/F', '/IM', 'electron.exe'], capture_output=True)
    time.sleep(1.4)


def make_test_background():
    """画一张高对比彩色背景：模糊是否生效，看边缘糊不糊就知道。"""
    path = os.path.join(BACKGROUNDS, TEST_BG)
    os.makedirs(BACKGROUNDS, exist_ok=True)
    if os.path.exists(path):
        return
    w, h = 1920, 1200
    im = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(im)
    # 斜向渐变的底色
    for y in range(h):
        t = y / h
        r = int(28 + 40 * t)
        g = int(46 + 18 * t)
        b = int(96 + 70 * t)
        d.line([(0, y), (w, y)], fill=(r, g, b))
    # 几个高饱和色块，模糊后会明显晕开
    blobs = [
        (260, 220, 320, (255, 138, 48)),
        (1180, 180, 380, (42, 212, 200)),
        (760, 860, 420, (240, 69, 126)),
        (1620, 900, 300, (247, 210, 62)),
        (120, 960, 260, (78, 123, 232)),
    ]
    for cx, cy, r, color in blobs:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
    # 细网格，用来判断"模糊半径到底吃掉了多少细节"
    for x in range(0, w, 40):
        d.line([(x, 0), (x, h)], fill=(20, 24, 34), width=2)
    for y in range(0, h, 40):
        d.line([(0, y), (w, y)], fill=(20, 24, 34), width=2)
    im.save(path)
    print(f'生成测试背景：{path}')


def set_cfg(**kw):
    c = json.load(open(CFG, encoding='utf-8'))
    c['general'].update(kw)
    json.dump(c, open(CFG, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
    return c


def shoot(name, **kw):
    killall()
    # 配置里可能还留着旧的 glassOpacity，不显式指定的话测的就不是新默认值
    kw.setdefault('glassOpacity', 0.32)
    c = set_cfg(**kw)
    env = dict(os.environ)
    env.pop('ELECTRON_RUN_AS_NODE', None)
    p = subprocess.Popen(
        [ELECTRON, '.'],
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(6.5)
    im = ImageGrab.grab(all_screens=True)
    bb = c['ui']['windowBounds']
    box = (bb['x'], bb['y'], bb['x'] + bb['width'], bb['y'] + bb['height'])
    crop = im.crop(box)
    out = os.path.join(SHOTS, f'v114-{name}.png')
    crop.save(out)

    # 采样：侧栏空白处 / 内容区空白处 / 卡片位置
    probes = {'side': (90, 640), 'content': (760, 720), 'card': (140, 250)}
    vals = {k: im.getpixel((bb['x'] + dx, bb['y'] + dy)) for k, (dx, dy) in probes.items()}
    outside = im.getpixel((40, 30))
    print(f'{name:24s} 窗口外={outside}  ' + '  '.join(f'{k}={v}' for k, v in vals.items()))
    p.terminate()
    p.wait(timeout=15)
    time.sleep(1.2)
    return out


def main():
    make_test_background()
    cases = [
        ('glass-light-solid', dict(theme='glass', scheme='light', background='solid')),
        ('glass-dark-solid', dict(theme='glass', scheme='dark', background='solid')),
        ('minimal-light-solid', dict(theme='minimal', scheme='light', background='solid')),
        ('minimal-dark-solid', dict(theme='minimal', scheme='dark', background='solid')),
        (
            'glass-light-image',
            dict(theme='glass', scheme='light', background='image', backgroundImage=TEST_BG, glassBlur=28),
        ),
        (
            'glass-dark-image',
            dict(theme='glass', scheme='dark', background='image', backgroundImage=TEST_BG, glassBlur=28),
        ),
        (
            'minimal-light-image',
            dict(theme='minimal', scheme='light', background='image', backgroundImage=TEST_BG),
        ),
    ]
    for name, kw in cases:
        shoot(name, **kw)
    killall()
    print('完成')


if __name__ == '__main__':
    main()
