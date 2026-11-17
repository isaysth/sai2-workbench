# SAI2 Plugin Suite

A companion toolkit for **PaintTool SAI Ver.2 (64-bit)** on Windows 10/11.
SAI2 has no plugin API, so the suite works beside it: it copies the current layer
through the clipboard, renders in its own windows, then pastes the result back.

> Version: **1.64.0** · Chinese: [README.md](README.md) · Manual: [English](Manual.en.md) / [中文](使用说明.md)

## Features

- **Blur (9)**: Gaussian, Box, Motion, Radial, Surface, Smart, Lens, Average, Tilt-Shift
- **Filter gallery (53)**: Artistic / Brush Strokes / Distort / Sketch / Stylize / Texture / Pixelate / Sharpen / Noise / Blur, including Bloom, Path Blur, Parallel Chromatic Aberration, USM Sharpen
- **Adjust (11)**: Invert, Desaturate, Threshold, Posterize, Brightness/Contrast, Levels, Hue/Saturation, Color Balance, Gradient Map, Curves, **Stroke**
- **Liquify (8)**: Forward Warp, Bloat, Pinch, Twirl CW/CCW, Smooth, Reconstruct, Push Left
- **Selections**: rectangle, ellipse, lasso, magic wand, pen curve; feather, invert, move
- **Stroke**: outside / inside / center, color, 0.5–200 px, opacity
- **Line-art selection**: Alt+click flood-fill bounded by dark line art; **Fill Color** / **Erase**; **Through Eraser** for selected layers
- **Color Triangle**: HSV triangle + hue ring, copy HEX
- **Auto Actions**: record an effect chain, save as `.sai2act`, replay in one click
- **Multi-layer**: liquify all selected layers; batch-apply blur/filters/adjust
- **History**: jump back to any of our applied snapshots (not SAI2's native undo stack)
- **Grayscale overlay**: a click-through, always-on-top grayscale layer over the SAI2 canvas
- **Lab color picker**: a/b plane + L slider + copy HEX
- **Timelapse**: canvas/window capture, 1/2/5 s interval, pause/resume, 1080p/2K H.264 MP4
- **Brush import**: ABR (Photoshop) / SUT (Clip Studio) → SAI2 `blotmap`
- **Stats**: drawing/idle time, strokes, dabs
- **Appearance**: light/dark/system theme, accent color, UI font 90–120%, shortcut schemes
- **Languages**: Chinese / English UI (Tools → Appearance & shortcuts → Language)

## Quick start

1. Download `sai2-plugin-suite-1.64.0.zip` from Releases and extract it.
2. Right-click `添加白名单.bat` → **Run as administrator** (adds a Defender exclusion).
3. Open SAI2 and draw something.
4. Double-click `启动插件面板.bat` (or `sai2_bridge.exe`).
5. Click **Attach** (连接注入). The layer list should appear.
6. Grab a layer, open a tool window, adjust, click **Apply**.

The panel and SAI2 must run at the same privilege level (both normal or both admin).

## Panels

- **Settings ▾**: auto-paste, watch clipboard, select layer on click, chain mode,
  merge back, precise paste.
- **Tools ▾**: brush import, stamp visible, history, stats, grayscale preview/overlay,
  Lab picker, screen picker, actions, appearance/language, timelapse.
- **Stamp visible**: temporarily merges visible layers, copies the result, undoes the
  merge, then creates a new layer and pastes. It asks for confirmation and checks the
  layer count after undo.

## Selection

| Input | Action |
|---|---|
| `Shift` + drag | rectangle |
| `Ctrl+Shift` + drag | ellipse |
| `Alt+Shift` + drag | lasso |
| `Shift` + click | magic wand (`[` / `]` tolerance) |
| `Ctrl+Shift` + click | pen: add point; drag an anchor to reshape |
| `Enter` / click first point | close pen curve |
| `Backspace` | remove last pen point |
| `F` | feather 0/2/4/8/16/32 px |
| `Ctrl+Shift+I` | invert |
| `Ctrl+Alt` + drag | move selection |
| `Ctrl+D` | clear |
| hold `Alt+P` | compare with the grabbed original |

## Build

Requirements: Windows 10/11 x64 and [zig](https://ziglang.org/) (C++ toolchain).

```bash
ZIG=/path/to/zig bash scripts/build-zig.sh
```

Tests:

```bat
build-zig\tools\sai2_bridge.exe --selftest --out out
build-zig\tools\sai2_bridge.exe --selection-test
build-zig\tools\sai2_bridge.exe --action-test
build-zig\tools\sai2_bridge.exe --lab-test
build-zig\tools\sai2_bridge.exe --overlay-test
```

## Limitations

- 64-bit SAI2 only; clipboard round-trip is 8-bit.
- No native SAI2 undo stack, native selection, or layer-group live effects.
- Stroke is destructive (pixel-level), not an editable SAI2 stroke layer.
- Auto Actions support only this suite's effects (no native SAI2 filters/brush strokes).
- Lab picker copies HEX but does not set the SAI2 foreground color.
- Grayscale overlay does not temporarily restore color while panning.
- Multi-layer batch ignores selections for non-base layers and skips folders/masks.

## Links

- Downloads: <https://celery-play-game.top/posts/sai2-download.html>
- All resources: <https://celery-play-game.top/download/>
- Repository: <https://git.celery-play-game.top/owner/sai2-plugin-suite>
- License: MIT
