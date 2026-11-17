/**
 * 桌面自动化桥（Windows）：SendInput 合成键 + SAI2 窗口定位 + 注入器调用。
 *
 * 上游结论（docs/SAI2Injection.md §八之二 / §10）：
 *  - Ctrl+A / Ctrl+C / Ctrl+V 的 scancode 合成键在 2023.04.05 版实测有效；
 *  - 后台进程 SetForegroundWindow 会被前台锁拦，需 AttachThreadInput 强制；
 *  - 抓图走 Ctrl+A → Ctrl+C，回贴走 Ctrl+V，粘贴按画布 (0,0) 对齐。
 *
 * 全部通过 PowerShell P/Invoke user32，字节不经命令行。
 */
'use strict'

const { spawn } = require('node:child_process')

/** SendInput 合成 Ctrl+<key>。key: A=0x1E C=0x2E V=0x2F */
const KEY_PS = String.raw`
param([string]$KeyHex)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
[StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public KEYBDINPUT ki; public int pad; }
public class Keys {
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, INPUT[] p, int cb);
}
'@
$key = [Convert]::ToUInt16($KeyHex, 16)
function NewInput($vk,$scan,$flags) {
  $i = New-Object INPUT
  $i.type = 1
  $i.ki.wVk = $vk; $i.ki.wScan = $scan; $i.ki.dwFlags = $flags
  return $i
}
$ctrlDown = NewInput 0x11 0x1D 0x0008          # SCANCODE
$keyDown  = NewInput 0  $key 0x0008
$keyUp    = NewInput 0  $key (0x0008 -bor 0x0002)
$ctrlUp   = NewInput 0x11 0x1D (0x0008 -bor 0x0002)
$inputs = @($ctrlDown,$keyDown,$keyUp,$ctrlUp)
[void][Keys]::SendInput($inputs.Length, $inputs, [Runtime.InteropServices.Marshal]::SizeOf([type]'INPUT'))
Write-Output "OK"
`

/** 把前台窗口切到 SAI2（按进程名 sai2） */
const FOCUS_PS = String.raw`
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Focus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
'@
$p = Get-Process sai2 -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($null -eq $p) { Write-Output "NOWINDOW"; exit }
$h = $p.MainWindowHandle
[uint32]$targetPid = 0
$t = [Focus]::GetWindowThreadProcessId($h, [ref]$targetPid)
$me = [Focus]::GetCurrentThreadId()
$fg = [Focus]::GetForegroundWindow()
[uint32]$fgPid = 0
$fgt = [Focus]::GetWindowThreadProcessId($fg, [ref]$fgPid)
[void][Focus]::AttachThreadInput($me, $fgt, $true)
[void][Focus]::SetForegroundWindow($h)
[void][Focus]::AttachThreadInput($me, $fgt, $false)
Start-Sleep -Milliseconds 150
if ([Focus]::GetForegroundWindow() -eq $h) { Write-Output "OK" } else { Write-Output "FAILED" }
`

function run(script, args, opts = {}) {
  return new Promise((resolve, reject) => {
    if (opts.exec) return opts.exec(script, args, resolve, reject)
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script, ...args], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = '', err = ''
    ps.stdout.on('data', (c) => { out += c.toString() })
    ps.stderr.on('data', (c) => { err += c.toString() })
    ps.on('error', reject)
    ps.on('close', (code) => {
      if (code !== 0) reject(new Error(`PowerShell 退出码 ${code}：${err.trim()}`))
      else resolve(out)
    })
  })
}

async function focusSai2(opts) {
  const out = await run(FOCUS_PS, [], opts)
  return out.includes('OK')
}

/** 合成 Ctrl+A / Ctrl+C / Ctrl+V */
async function ctrl(key, opts) {
  const codes = { a: '1E', c: '2E', v: '2F' }
  const hex = codes[key]
  if (!hex) throw new Error(`不支持的键：${key}`)
  const out = await run(KEY_PS, [hex], opts)
  return out.includes('OK')
}

/** 抓当前图层：聚焦 → Ctrl+A → Ctrl+C */
async function grabLayer(opts) {
  const focused = await focusSai2(opts)
  if (!focused) throw new Error('无法把 SAI2 切到前台')
  await ctrl('a', opts)
  await new Promise((r) => setTimeout(r, 200))
  await ctrl('c', opts)
  await new Promise((r) => setTimeout(r, 300))
  return true
}

/** 贴回：聚焦 → Ctrl+V */
async function pasteBack(opts) {
  const focused = await focusSai2(opts)
  if (!focused) throw new Error('无法把 SAI2 切到前台')
  await ctrl('v', opts)
  await new Promise((r) => setTimeout(r, 200))
  return true
}

/** 屏幕坐标点击（用于点击 SAI2 图层行）。param: x y */
const CLICK_PS = String.raw`
param([int]$X,[int]$Y)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Mouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint dx,uint dy,uint d,IntPtr e);
}
'@
[void][Mouse]::SetCursorPos($X,$Y)
Start-Sleep -Milliseconds 60
[Mouse]::mouse_event(0x0002,0,0,0,[IntPtr]::Zero)
[Mouse]::mouse_event(0x0004,0,0,0,[IntPtr]::Zero)
Write-Output "OK"
`

/** 在屏幕坐标点击一下 */
async function clickAt(x, y, opts) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false
  const out = await run(CLICK_PS, [String(Math.round(x)), String(Math.round(y))], opts)
  return out.includes('OK')
}

/** 启动她的注入器（injector.exe inject），detached 不随工作台退出 */
function runInjector(injectorExe, action = 'inject') {
  return new Promise((resolve) => {
    const { existsSync } = require('node:fs')
    if (!existsSync(injectorExe)) {
      resolve({ ok: false, error: `注入器不存在：${injectorExe}` })
      return
    }
    const child = spawn(injectorExe, [action], { detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', (err) => resolve({ ok: false, error: err.message }))
    child.once('spawn', () => {
      child.unref()
      resolve({ ok: true })
    })
  })
}

module.exports = {
  focusSai2, ctrl, grabLayer, pasteBack, clickAt, runInjector, run,
  KEY_PS, FOCUS_PS, CLICK_PS
}
