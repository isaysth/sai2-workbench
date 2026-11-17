/**
 * 系统剪贴板桥（Windows）。
 *
 * 关键约束（上游实测）：写回 SAI2 时只能有 CF_DIBV5，绝不能同时有 CF_DIB，
 * 且布局必须是 124 头 + 12 掩码 + BGRA 像素。Electron 的 clipboard.writeImage
 * 控制不了这些细节，因此用 PowerShell + Win32 P/Invoke 精确写。
 *
 * 字节通过 stdin(base64) 传入，避免命令行长度限制与转义问题。
 */
'use strict'

const { spawn } = require('node:child_process')

/** 写 CF_DIBV5：EmptyClipboard 后只 SetClipboardData(CF_DIBV5) */
const WRITE_PS = String.raw`
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class Clip {
  [DllImport("user32.dll", SetLastError=true)] public static extern bool OpenClipboard(IntPtr h);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool EmptyClipboard();
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetClipboardData(uint u, IntPtr h);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool CloseClipboard();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr GlobalAlloc(uint f, UIntPtr n);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr GlobalLock(IntPtr h);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GlobalUnlock(IntPtr h);
}
'@
$b64 = [Console]::In.ReadToEnd().Trim()
$bytes = [Convert]::FromBase64String($b64)
if (-not [Clip]::OpenClipboard([IntPtr]::Zero)) { throw "OpenClipboard failed" }
try {
  [void][Clip]::EmptyClipboard()
  $h = [Clip]::GlobalAlloc(0x0002, [UIntPtr]::new($bytes.Length))
  $p = [Clip]::GlobalLock($h)
  [Marshal]::Copy($bytes, 0, $p, $bytes.Length)
  [void][Clip]::GlobalUnlock($h)
  $CF_DIBV5 = 17
  if ([Clip]::SetClipboardData($CF_DIBV5, $h) -eq [IntPtr]::Zero) { throw "SetClipboardData failed" }
} finally {
  [void][Clip]::CloseClipboard()
}
Write-Output "OK"
`

/** 读 CF_DIBV5：把字节以 base64 输出到 stdout */
const READ_PS = String.raw`
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$obj = [System.Windows.Forms.Clipboard]::GetDataObject()
if ($null -eq $obj) { Write-Output ""; exit }
$CF_DIBV5 = 17
if (-not $obj.ContainsData("Format17") -and -not $obj.GetDataPresent([System.Windows.Forms.DataFormats]::Bitmap)) {
  # 退而求其次：尝试按 int 17 读
}
try {
  $data = $obj.GetData(17)
  if ($null -eq $data) { Write-Output ""; exit }
  $ms = New-Object System.IO.MemoryStream
  $data.CopyTo($ms)
  [Convert]::ToBase64String($ms.ToArray())
} catch { Write-Output "" }
`

/**
 * 执行一段 PowerShell，stdin 传输入，返回 stdout。
 * opts.exec 可注入（单测用），默认 spawn powershell -NoProfile -NonInteractive -Command。
 */
function runPowerShell(script, input, opts = {}) {
  return new Promise((resolve, reject) => {
    if (opts.exec) return opts.exec(script, input, resolve, reject)
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let out = ''
    let err = ''
    ps.stdout.on('data', (c) => { out += c.toString() })
    ps.stderr.on('data', (c) => { err += c.toString() })
    ps.on('error', reject)
    ps.on('close', (code) => {
      if (code !== 0) reject(new Error(`PowerShell 退出码 ${code}：${err.trim()}`))
      else resolve(out)
    })
    if (input != null) ps.stdin.write(input)
    ps.stdin.end()
  })
}

/** 写 DIBV5 字节到剪贴板 */
async function writeDIBV5(buffer, opts) {
  const out = await runPowerShell(WRITE_PS, Buffer.from(buffer).toString('base64'), opts)
  if (!out.includes('OK')) throw new Error(`写剪贴板未确认：${out.trim()}`)
  return true
}

/** 读剪贴板 DIBV5 字节；空返回 null */
async function readDIBV5(opts) {
  const out = await runPowerShell(READ_PS, '', opts)
  const b64 = out.trim()
  if (!b64) return null
  return Buffer.from(b64, 'base64')
}

module.exports = { writeDIBV5, readDIBV5, runPowerShell, WRITE_PS, READ_PS }
