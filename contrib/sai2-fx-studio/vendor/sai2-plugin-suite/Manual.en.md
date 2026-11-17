# SAI2 Plugin Suite — Manual

> Full reference manual. First time here? Read **[Tutorial.en.md](Tutorial.en.md)** instead —
> it walks you through install → first effect, one action at a time.
>
> Version: **1.64.0** · Windows 10/11 x64 · 64-bit SAI2 only · MIT

---

## 0. Tool overview

| Category | Tool | What it does | Where |
|---|---|---|---|
| Blur | Gaussian / Box / Motion / Radial / Surface / Smart / Lens / Average / Tilt-shift (9) | Softening, depth of field, motion trails, miniature look | Panel **Blur** or `Ctrl+Alt+1` |
| Filter gallery | 53 filters across Artistic / Brush Strokes / Distort / Sketch / Stylize / Texture / Pixelate / Sharpen / Noise / Blur | Stylise, texture, glow, pixelate; includes Bloom, Path Blur, Chromatic Aberration | Panel **Filter** or `Ctrl+Alt+2` |
| Adjust | Invert / Desaturate / Threshold / Posterize / Brightness-Contrast / Levels / Hue-Saturation / Color Balance / Gradient Map / Curves / **Stroke** / **Fill Color** / **Erase** (13) | Colour, tone, black-and-white, outlines, line-art fill/erase | Panel **Adjust** or `Ctrl+Alt+3` |
| Liquify | Forward Warp / Bloat / Pinch / Twirl CW / Twirl CCW / Smooth / Reconstruct / Push (8) | Push pixels, reshape faces, hair, fabric folds | Panel **Liquify** or `Ctrl+Alt+4` |
| Selection | Rect / Ellipse / Lasso / Magic Wand / Pen curve; feather, invert, move | Change only a small area | Modifier keys on any tool window |
| Stroke | Outside / Inside / Center + colour + opacity | Outline the current layer | Adjust → Stroke |
| Canvas stamp | Merge visible → copy → undo → paste (SAI2 paste creates the layer) | "Stamp visible" with originals kept; exactly one new layer | Tools ▾ → Canvas stamp… |
| Color Triangle | HSV triangle + hue ring | Pick colour, copy HEX | Tools ▾ → Color Triangle |
| Line-art selection | Alt+click, bounded by dark line art | Select an enclosed region | Alt+click on a tool canvas |
| Through Eraser | Erase the same selection on selected layers | Erase several layers at once | Tools ▾ → Through Eraser |
| Language | Chinese / English UI | For English-speaking users | Tools ▾ → Appearance & shortcuts → Language |
| Auto Actions | Record an effect chain, replay it, save `.sai2act` | Repeat filter/colour stacks in one click | Tools ▾ → Actions |
| Multi-layer | Liquify together / Batch colour | Same deformation or effect across layers | Select several layers, then Apply |
| History | Our own apply history (not SAI2's undo stack) | Return to before a previous apply | Tools ▾ → History |
| Grayscale | Preview grayscale + live overlay on the SAI2 canvas | Check value relationships | Tools ▾ |
| Lab picker | a/b gamut + L slider + copy HEX | Pick colours in Lab | Tools ▾ → Lab picker |
| Timelapse | Canvas/window, 1/2/5 s, pause-resume, 1080p/2K | Record painting as MP4 | Tools ▾ |
| Brush import | ABR / SUT → SAI2 blotmap | Bring PS/CSP brush tips into SAI2 | Tools ▾ → Brush import |
| Statistics | Painting/idle time, strokes, samples | See how long you actually painted | Tools ▾ → Statistics |
| Appearance | Theme, accent colour, font 90–120%, hotkey scheme | Restyle the UI | Tools ▾ → Appearance & shortcuts |

**Which one do I need?** Softening → Blur. Style/texture → Filter gallery. Colour/tone → Adjust.
Reshape → Liquify. Only part of the image → make a selection first. Repeating yourself → record an
Auto Action. Several layers at once → select them.

---

## 1. How it works

SAI2 has no plugin API (no export table, no extension mechanism). This suite does **not** modify
`sai2.exe`. Instead it:

1. Copies the current SAI2 layer to the **clipboard**
2. Processes it in a separate companion window
3. Writes the result back to the clipboard and **pastes / merges it into SAI2**

"Connect" injects a **read-only** observer DLL (IAT hook) used only to read the layer list, canvas
geometry and thumbnails. It never modifies SAI2 code and never executes SAI2 commands for you.

Consequences:

- Selections, stroke and Auto Actions all operate on **the image we captured**
- SAI2's native menu commands, filters and brush strokes **cannot** be invoked
- The clipboard round-trip is **8-bit**, so 16-bit / float layers lose precision

---

## 2. Install and connect

### 2.1 Requirements

- Windows 10 / 11 **x64**
- **64-bit SAI2** (32-bit is rejected with a clear message)
- No runtime needed — unzip and run

### 2.2 Install

1. Download `sai2-plugin-suite-1.64.0.zip` and extract it anywhere
2. **Right-click `添加白名单.bat` → Run as administrator** (adds the folder to Defender exclusions)
3. Third-party AV (360, Huorong…): add the folder to its trusted zone manually
4. Open SAI2 and paint a stroke (so there is a non-empty layer)
5. Double-click `启动插件面板.bat` (or `sai2_bridge.exe`)

> The launcher now stops and explains itself if the panel fails to start, and ships `诊断.bat`
> which writes `诊断.txt` with the details to send back.

### 2.3 Privileges must match

Windows forbids injecting into a higher-integrity process:

- SAI2 normal → panel normal
- SAI2 as admin → panel as admin (or use **Restart as admin** in the panel)

Mismatch looks like: stuck at "Not connected", empty layer list, log shows
`OpenProcess ... Win32 5 / access denied`.

### 2.4 Connect

Click **Connect** in the panel. On success the layer list fills and the status turns "Connected".
If it fails, check `logs\bridge.log` and the report from `诊断.bat`.

---

## 3. Main panel

### 3.1 Top bar

- **Theme** — left click cycles Light / Dark / Follow system
- **Connect / Restart as admin**
- **Refresh layers**
- **Grab selected layer(s)**

### 3.2 Layer list

- Click to select one; `Ctrl+click` to multi-select; `Shift+click` for a range
- With "Select row in SAI2" enabled, clicking a row also selects that layer inside SAI2
- Folder rows are marked "(folder)"; batch operations skip folders

### 3.3 Grab and apply

- **Grab SAI2 layer** — copy the current layer in (preferred: it also captures canvas size/offset)
- **Apply → clipboard** — render the current effect, write the clipboard, optionally auto-paste/merge
- **Undo** — undo the last apply; **Reset** — back to the freshly grabbed image

### 3.4 Settings ▾

| Option | Effect | Suggested |
|---|---|---|
| Auto-paste back into SAI2 | Sends `Ctrl+V` after apply | On |
| Watch clipboard | Grabbing automatically when you press `Ctrl+C` in SAI2 | On |
| Select row in SAI2 when clicked | Switches SAI2 layers (simulates a mouse click) | As needed — off since 1.59 |
| Chain processing | Continue on the current result instead of the original | On for multi-step effects |
| Merge back into original layer | Pastes then "merge down" so the layer count stays | Off if you want to keep layers |
| Precise paste | Pads the result to canvas size so it lands in place | On |

### 3.5 Tools ▾

- Brush import…
- Canvas stamp…
- History / Statistics / Grayscale preview / Grayscale overlay on SAI2 / Lab picker / Screen colour picker
- Actions ▸ Start recording / Stop and save / Play last / Choose action / Open folder
- Appearance & shortcuts ▸ Accent colour / UI font / Hotkey scheme / Language
- Timelapse ▸ Start/Stop / Pause-Resume / Canvas only / Frame interval / 2K / Open folder

### 3.6 Status area

- Top line: status, recording info, number of recorded action steps
- Below: log (6 lines; set `SAI2_UI_LOG=1` to expand)
- Bottom left: clipboard format/size; **⚠ no canvas size** means precise paste is unavailable

---

## 4. Tool windows

All four windows share one layout:

```
[Current tool ▾]  [Algorithm ▾]                        Theme
┌────────────────────────────────────┬──────────────────┐
│              Preview               │  Sliders / values │
└────────────────────────────────────┴──────────────────┘
                              [Undo] [Reset] [Close] [Apply]
```

- **Current tool ▾** — Blur / Filter / Adjust / Liquify
- **Algorithm ▾** — switch algorithm inside the current tool
- Preview: wheel to zoom (2 %–3200 %), right-drag to pan
- Parameters: slider + numeric box (click selects all; `Enter` commits, `Esc` reverts)
- Bottom: **Undo** last apply, **Reset** to the grabbed image, **Close**, **Apply**
- **Hold `Alt+P`** to compare with the originally grabbed image
- Large canvases render in the background showing `⏳ Applying…`; press `Esc` to cancel — SAI2 stays untouched

---

## 5. Blur (9)

| Algorithm | Main parameters | Use |
|---|---|---|
| Gaussian | Radius | General softening, depth of field |
| Box | Radius | Faster, "squarer" softening |
| Motion | Angle, distance | Speed, trails |
| Radial | Amount, method (spin/zoom), quality, centre X/Y | Spin / zoom blur |
| Surface | Radius, threshold | Edge-preserving smoothing (skin) |
| Smart | Radius, threshold, quality | Edge-preserving denoise |
| Lens | Radius, brightness threshold… | Bokeh, depth of field |
| Average | Radius | Block averaging |
| Tilt-shift | Angle, position, range | Miniature effect |

Gaussian blur uses the GPU backend when available and silently falls back to CPU. All blurs respect
the selection.

---

## 6. Filter gallery (53)

Browse by category: Artistic, Brush Strokes, Distort, Sketch, Stylize, Texture, Pixelate, Sharpen,
Noise, Blur.

Notable hand-written filters:

- **Bloom** — threshold, radius, intensity
- **Path blur** — samples along a quadratic Bézier, adjustable curvature
- **Chromatic aberration** — horizontal/vertical RGB offsets
- **USM sharpen** — amount 0–300 %, radius 1–10 px, threshold 0–50
- **Add noise** — uniform/Gaussian, monochrome toggle
- **Mosaic / Pixelate**, and more

Pick a category on the left, a thumbnail in the middle, adjust parameters on the right. All filters
support selections.

---

## 7. Adjust (11)

| Effect | Parameters | Notes |
|---|---|---|
| Invert | — | Per-channel complement |
| Desaturate | — | Luminance-based |
| Threshold | 0–255 | Binarize |
| Posterize | Levels | Poster look |
| Brightness/Contrast | Brightness, contrast | Basic tone |
| Levels | Black, white, gamma | Three-point mapping |
| Hue/Saturation | Hue, saturation, lightness | HSL |
| Color Balance | Shadows / midtones / highlights | Colour cast per range |
| Gradient Map | Preset + blend; custom stops | Map luminance to a gradient |
| Curves | RGB / R / G / B | Draggable control points |
| Stroke | Width, position, opacity, colour | See §10 |

**Gradient Map**: click the bar to add a stop, drag to move, `Delete` to remove, **Reverse** flips the stops, *Change
colour* to pick, *Save/Load* `.grad` files, *Reset* back to black→white.
**Curves**: click empty grid space to add a point, drag to move, `Delete` to remove; black/white/midtone
sliders below.

---

## 8. Liquify (8)

| Tool | Behaviour |
|---|---|
| Forward Warp | Pushes pixels in the drag direction |
| Bloat / Pinch | Continuous force while the button is held |
| Twirl CW / CCW | Rotate under the cursor |
| Smooth | Smooths jittery edges |
| Reconstruct | Brush to restore; Reconstruct mode: Restore All / Smooth / Sharpen / Boundary |
| Push | Pushes perpendicular to the drag direction |

- `[` / `]` — brush size; `Ctrl+Z` — undo the last stroke
- The brush ring follows the cursor; right-drag pans the canvas
- **Liquify several layers with the same deformation**: `Ctrl+click` layers in the list →
  *Grab selected layers* → liquify → Apply. The main layer pastes back, the others are processed one
  by one in the background; layers stay separate
- Folder layers cannot be liquified together; masks are unsupported

---

## 9. Selections

On the canvas of **any** tool window:

| Action | Result |
|---|---|
| `Shift + drag` | Rectangular selection |
| `Ctrl + Shift + drag` | Elliptical selection |
| `Alt + Shift + drag` | Lasso (freehand, closes on release) |
| `Shift + click` | Magic wand (contiguous colour, tolerance 32) |
| `[` / `]` | Wand tolerance −8 / +8 (8–160) |
| `Ctrl + Shift + click` | Pen: add a point; drag an anchor to move it |
| Click the first point / `Enter` | Close the pen path (Catmull-Rom smoothing, then polygon) |
| `Backspace` / `Delete` | Remove the last pen point |
| `F` | Feather cycle 0 → 2 → 4 → 8 → 16 → 32 px |
| `Ctrl + Shift + I` | Invert |
| `Ctrl + Alt + drag` | Move an existing selection (rect/ellipse/lasso/wand) |
| `Ctrl + D` | Clear |

- Selections use **normalized coordinates**, shared by the preview and the full-resolution commit,
  so they never drift when zooming
- Only pixels inside the selection change; outside is restored via the alpha mask (feathering blends)
- The wand mask is generated at preview resolution; pen anchors are screen coordinates — do not drag
  old anchors after zooming
- SAI2's own lasso/wand selections **cannot** be read (they live inside SAI2)

---

## 10. Stroke

**Adjust → Stroke.**

| Parameter | Meaning |
|---|---|
| Colour | Click the swatch to open the system picker |
| Width | 0.5–200 px (full-resolution pixels) |
| Position | Outside / Inside / Center |
| Opacity | 0–100 % |

Built on a distance field over the layer alpha: outside expands the alpha, inside eats into the edge,
center splits the difference; 1 px anti-aliasing. With a selection active, only the selected region is
stroked.

Notes:

- This is a **pixel-level stroke**, not SAI2's editable stroke layer
- Applies to the current layer only; process layer groups layer by layer
- If a layer is fully opaque, inside/center treat the canvas edge as the transparency boundary
- The result is clipped to the canvas; the canvas is never enlarged

---

### Line-art selection / Fill / Erase

- **Alt+click** on the canvas: flood-fill stops at dark line art (luma < 100), selecting the enclosed region.
- **Adjust → Fill Color** fills the selection; **Adjust → Erase** makes it transparent.
- **Through Eraser**: make a selection, multi-select layers, then Tools → Through Eraser (selected layers).

## 11. Auto Actions

**Tools ▾ → Actions.**

### Recording

1. Grab a layer first (the recorder stores effects, not pixels)
2. Actions → **Start recording**
3. Tune an effect and press Apply — each successful apply appends one step (effect id + parameters +
   the current selection)
4. Actions → **Stop and save…** into `actions\*.sai2act`
5. The status bar shows `● Recording: N steps`

### Replay

- Grab an image (replay starts from the **currently grabbed original**; it does not re-grab)
- Actions → **Play last action**, or **Choose action…**
- Steps run in order; the clipboard is written once and pasted once at the end
- On failure the log names the failing step; no partial result is pasted
- Replay does **not** enter the history stack (it is just clipboard + paste)

### Files

`.sai2act` is UTF-8 text (`type=effect`, `id=`, `params=`, `ev=`, `sel=`, `poly=`), so you can inspect
or edit it by hand.

### Limits

- Only records **this suite's** effects (blur/filter/adjust), not SAI2's native filters, layer menus
  or brush strokes
- Wand masks are stored as their bounding box
- Liquify steps are not recommended (hand-drawn strokes are not reproducible)
- Replaying a selection uses the recorded normalized coordinates, so a layer with a different offset
  will be off

---

## 12. Multi-layer and batch

### Canvas stamp

**Tools ▾ → Canvas stamp…**: temporarily merge visible layers → copy the result → undo the merge →
paste (SAI2 paste creates the new layer automatically). A confirmation dialog comes first; if the
layer count did not drop after merging, or the undo did not restore the stack, the operation aborts and
logs why. On success exactly one merged-result layer is added; originals remain.

Use it to freeze "what I currently see" into a new layer while keeping the original layers intact.

### Liquify together

See §8: multi-select layers → grab → liquify → apply.

### Batch colour

Select several layers, tune the effect, press Apply:

- The base layer goes through the normal paste-back path
- Each other layer: click its row → `Ctrl+A`/`Ctrl+C` → locate canvas offset → apply the same effect →
  paste back → (optional) merge down
- Works for blur / filter / adjust; liquify uses "Liquify together"
- **With a selection only the base layer is processed** (normalized coordinates would be wrong on the
  other layers' offsets)
- Folders and masks are not supported

---

## 13. History

**Tools ▾ → History.**

- Lists **our own apply snapshots** (one per Apply / Reset) with the effect name
- Click any entry to return to the state **before** that operation; later steps are discarded
- This is not SAI2's undo stack; SAI2's own history cannot be read
- Depth is bounded by a memory budget (about 512 MB, max 20 entries)

---

## 14. Grayscale

Two independent features:

1. **Grayscale preview** — turns the tool window preview gray (display only)
2. **Grayscale overlay on the SAI2 canvas** — a topmost, click-through window that captures the SAI2
   client area and shows it gray

Overlay details:

- Uses the agent to locate the canvas paper area; falls back to whole-window gray when it cannot
- Refreshes about every 120 ms; hides itself when SAI2 is minimized
- Click-through, so you can keep painting in SAI2
- Panning does **not** temporarily restore colour (the reference behaviour is not implemented)

---

## 15. Lab colour picker

**Tools ▾ → Lab picker.**

- Click in the a/b gamut, drag the L slider
- Live readout of `L/a/b`, `sRGB` and `#HEX`
- **Copy HEX** writes it to the clipboard
- Always-on-top window
- It does **not** set SAI2's foreground colour (that would require simulating clicks on SAI2's colour
  panel); copy the HEX into SAI2's picker instead

---

### Color Triangle

**Tools ▾ → Color Triangle**: hue ring + HSV triangle (white / black / current hue); pick a colour, read HSV/RGB/HEX, and copy HEX.

## 16. Timelapse

**Tools ▾ → Timelapse.**

| Item | Meaning |
|---|---|
| Start/Stop | Start recording SAI2; stop finalizes the MP4 |
| Pause/Resume | Keeps the file open and appends to the same video |
| Canvas only | Crops out the toolbars using canvas geometry; falls back to whole window |
| Frame interval | 1 / 2 / 5 seconds |
| 2K | Output long edge 2560, otherwise 1920 |
| Open folder | Opens `timelapse\` |

- Identical frames are skipped automatically
- Output is H.264 MP4; on stop you get frame count / duration / size
- Paused time is not counted in the recorded duration
- Only the visible SAI2 window is captured; minimized windows produce nothing

---

## 17. Brush import

**Tools ▾ → Brush import…**, or from the command line:

```bat
sai2_bridge.exe --brush-convert "D:\sai2" a.abr b.sut
```

- Supports Photoshop **ABR** (v1/v2/v6/v7/v9/v10) and Clip Studio **SUT**
- Tips become SAI2 `blotmap\<name>.bmp` (8-bit gray, square 256/512/1024)
- Appends `1,blotmap\<name>.bmp` to `brushform.conf`
- SAI allows at most 99 brush shapes; a full list aborts with a message
- **Restart SAI2** to see them under "Brush shape"
- No duplicate detection, no automatic backup, no export back to ABR/SUT

---

## 18. Statistics

**Tools ▾ → Statistics.**

- Painting time — accumulated time with the brush held down
- Idle time — total uptime minus painting time
- Strokes / samples — number of strokes / samples per stroke
- **Reset** zeroes timers and counters (switching images does not reset)
- Counters live in this process only; closing the panel restarts them

---

## 19. Appearance, language, shortcuts

**Tools ▾ → Appearance & shortcuts:**

- **Accent colour…** — system picker; foreground is chosen automatically
- **UI font** — 90 % / 100 % / 110 % / 120 %
- **Hotkey scheme** — `Ctrl+Alt` (default) / `Ctrl+Shift` / `Alt+Shift`
- **Language / 语言** — Chinese / English UI, effective immediately (newly opened window titles are
  translated too)
  - Switching re-registers all 8 global hotkeys
  - Conflicts are logged as `hotkey FAILED`
- Settings live in `HKCU\Software\SAI2Bridge`

Schemes are switched as a whole; per-action customisation is not supported.

---

## 20. Shortcuts

### Global (default Ctrl+Alt scheme)

| Key | Action |
|---|---|
| `Ctrl+Alt+G` | Grab layer |
| `Ctrl+Alt+A` | Apply |
| `Ctrl+Alt+Z` | Undo last apply |
| `Ctrl+Alt+R` | Reset to original |
| `Ctrl+Alt+1/2/3/4` | Open Blur / Filter / Adjust / Liquify |

### Tool windows

| Key | Action |
|---|---|
| `Alt+P` (hold) | Compare with the original |
| `Esc` | Cancel apply / close window |
| `Ctrl+Z` | Undo (in Liquify: undo last stroke) |
| `Ctrl+D` | Clear selection (also cancels the pen) |
| `F` | Feather cycle |
| `Ctrl+Shift+I` | Invert selection |
| `Ctrl+Alt+drag` | Move selection |
| `Shift+drag` / `Ctrl+Shift+drag` / `Alt+Shift+drag` | Rect / ellipse / lasso |
| `Shift+click` / `[` `]` | Magic wand / tolerance |
| `Ctrl+Shift+click` | Pen: add point |
| `Enter` | Close pen path |
| `Backspace` / `Delete` | Delete pen point |
| `[` `]` | Liquify brush size |

> The `Undo / Reset / Close` buttons show their full labels on hover.

---

## 21. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Stuck at "Not connected" | Privilege mismatch; add the whitelist; check `Win32 5 / access denied` in the log |
| No image after grabbing | The current SAI2 layer is empty, or you copied a selection instead of the layer |
| Pasted in the wrong place | Status bar shows "⚠ no canvas size"; connect and grab the whole layer |
| Nothing changed in SAI2 | Auto-paste is off — press `Ctrl+V` in SAI2 yourself |
| Pixels outside the selection changed | The selection was cleared; watch the "Selection:" line, press `Ctrl+D` and redraw |
| Wand selects too much/little | Adjust tolerance with `[` / `]` |
| Stroke does nothing | The layer is fully transparent; or "Outside" on an opaque layer — try Inside/Center |
| Auto Action replays off-position | Grab the whole layer before replaying; look for `action: paste ctx=...` in the log |
| Grayscale overlay misaligned | Canvas location failed and it fell back to whole-window; look for `gray overlay: canvas ...` |
| Lab picker cannot set the foreground colour | By design — copy the HEX instead |
| Hotkeys do nothing | Taken by another app; switch scheme in Tools → Appearance & shortcuts |
| Timelapse file will not open | Too few frames / encoder failure; see the status bar, retry at 1080p |
| Imported brushes are missing | SAI2 was not restarted, or the 99-shape limit is reached |

Logs: `logs\bridge.log`; set `SAI2_BRIDGE_DIAG=1` for `logs\ui-diag.log` as well.

---

## 22. Known limitations

- Windows 10/11 x64 with **64-bit SAI2** only
- Clipboard round-trip is **8-bit**; 16-bit/float layers lose precision
- SAI2's native history, native selections and live layer-group rendering are unreadable
- Stroke is pixel-level, not an editable stroke layer; groups must be processed layer by layer
- Auto Actions cover this suite's effects only; no brush strokes or native commands
- Grayscale overlay depends on the agent for canvas location; panning does not restore colour
- Lab picker does not write SAI2's foreground colour
- Batch multi-layer: selections affect the base layer only; folders/masks unsupported
- Only three hotkey schemes; no per-action customisation
- Brush import: no dedupe, no backup, no export
- Canvas stamp relies on SAI2's undo to restore layers — save before using it
- The English UI is beta: main panel, menus, windows and parameters are translated; some dynamic
  status text and logs remain Chinese

---

## 23. Self-test

```bat
sai2_bridge.exe --selftest --out selftest-out   :: end-to-end (currently 200 checks)
sai2_bridge.exe --uitest                        :: open all four tool windows
sai2_bridge.exe --selection-test                :: selection / feather / invert / move
sai2_bridge.exe --action-test                   :: action save + replay
sai2_bridge.exe --lab-test                      :: Lab → sRGB anchors
sai2_bridge.exe --overlay-test                  :: grayscale overlay lifecycle
sai2_bridge.exe --brush-selftest                :: ABR/SUT parsing
sai2_injector.exe selftest                      :: injection chain (fake SAI2)
```

Exit code = number of failures.

---

## 24. Uninstall

Close the panel and SAI2, delete the folder. Leftovers:

- `plugins\registry.json` (plugin enable state)
- `HKCU\Software\SAI2Bridge` (theme, window positions, hotkey scheme, action paths)
- If you added the whitelist, run as admin in PowerShell:

```powershell
Remove-MpPreference -ExclusionPath "D:\SAI2\sai2-plugin-suite-1.64.0"
```

---

Demo video: `sai2_功能演示.mp4` (40 s, H.264)
Project: <https://git.celery-play-game.top/owner/sai2-plugin-suite> · MIT License
