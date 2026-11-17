"""验证「桌面」背景：窗口是否真的看穿到壁纸，以及不透明度 0 时是否干净。

为什么要垫底图：桌面模式透的是窗口**后面**的画面，而窗口后面的桌面是纯白，
白色玻璃压白色背景看不出任何差别。先铺一张纯色全屏底图，再采样"窗口内 vs 窗口外"
的像素是否一致 —— 一致就说明中间没有任何白膜残留。
"""

import json
import os
import subprocess
import time

from PIL import ImageGrab

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ELECTRON = os.path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
CFG = os.path.join(ROOT, 'data', 'config.json')
SHOTS = os.path.join(ROOT, 'docs', 'shots')


def killall():
    subprocess.run(['taskkill', '/F', '/IM', 'electron.exe'], capture_output=True)
    time.sleep(1.4)


def env_clean():
    e = dict(os.environ)
    e.pop('ELECTRON_RUN_AS_NODE', None)
    return e


def run_case(name, **kw):
    killall()
    c = json.load(open(CFG, encoding='utf-8'))
    c['general'].update(kw)
    c['general']['backgroundImage'] = ''
    json.dump(c, open(CFG, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

    env = env_clean()
    backdrop = subprocess.Popen(
        [ELECTRON, 'tools/glass_backdrop/main.js'],
        cwd=ROOT,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(4.5)
    bg = ImageGrab.grab(all_screens=True).getpixel((120, 120))

    app = subprocess.Popen(
        [ELECTRON, '.'], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    time.sleep(6.5)
    im = ImageGrab.grab(all_screens=True)
    im.save(os.path.join(SHOTS, f'v114-{name}.png'))

    bb = c['ui']['windowBounds']
    probes = {'sidebar': (90, 640), 'content': (760, 720), 'titlebar': (700, 20), 'card': (140, 250)}
    vals = {k: im.getpixel((bb['x'] + dx, bb['y'] + dy)) for k, (dx, dy) in probes.items()}
    print(f'{name}:  底图={bg}  ' + '  '.join(f'{k}={v}' for k, v in vals.items()))

    app.terminate()
    app.wait(timeout=15)
    backdrop.terminate()
    backdrop.wait(timeout=15)
    time.sleep(1.2)


if __name__ == '__main__':
    run_case('desktop-alpha0', theme='glass', scheme='light', background='desktop', glassOpacity=0.0, glassBlur=20)
    run_case('desktop-alpha32', theme='glass', scheme='light', background='desktop', glassOpacity=0.32, glassBlur=20)
    run_case('desktop-minimal', theme='minimal', scheme='light', background='desktop', glassOpacity=0.32)
    killall()
    print('完成')
