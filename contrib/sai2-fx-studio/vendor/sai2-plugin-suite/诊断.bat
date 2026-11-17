@echo off
rem ===========================================================================
rem 诊断.bat - 面板起不来时双击它，会在同目录生成「诊断.txt」
rem 把那个文件发回来，就能定位原因（不需要装任何东西）
rem ===========================================================================
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
set "OUT=%~dp0诊断.txt"

> "%OUT%" echo ==== SAI2 插件套件 诊断 ====
>>"%OUT%" echo 时间: %DATE% %TIME%
>>"%OUT%" echo 目录: %~dp0
>>"%OUT%" echo.

>>"%OUT%" echo ---- 系统 ----
>>"%OUT%" ver
powershell -NoProfile -Command "$o=[Environment]::OSVersion.VersionString; $b=(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'); Write-Output ('OS: '+$o); Write-Output ('产品: '+$b.ProductName+'  Build '+$b.CurrentBuild+'.'+$b.UBR); Write-Output ('位数: '+$env:PROCESSOR_ARCHITECTURE)" >>"%OUT%" 2>&1
>>"%OUT%" echo.

>>"%OUT%" echo ---- 目录内容 ----
dir /b >>"%OUT%" 2>&1
>>"%OUT%" echo.

>>"%OUT%" echo ---- 关键文件版本 ----
powershell -NoProfile -Command "Get-ChildItem -Filter *.exe | ForEach-Object { '{0}  {1}  {2} 字节' -f $_.Name, $_.VersionInfo.FileVersion, $_.Length }" >>"%OUT%" 2>&1
powershell -NoProfile -Command "if (Test-Path plugins) { 'plugins 子目录: ' + ((Get-ChildItem plugins -Directory).Name -join ', ') } else { 'plugins 目录不存在！' }" >>"%OUT%" 2>&1
>>"%OUT%" echo.

>>"%OUT%" echo ---- 运行库 / 组件检查 ----
powershell -NoProfile -Command "foreach ($d in 'ucrtbase.dll','MFPlat.dll','MFReadWrite.dll','d3d11.dll') { $p = Join-Path $env:SystemRoot ('System32\'+$d); '{0,-16} {1}' -f $d, (Test-Path $p) }" >>"%OUT%" 2>&1
>>"%OUT%" echo.

>>"%OUT%" echo ---- 当前进程 ----
>>"%OUT%" echo [sai2.exe 是否运行]
tasklist /fi "imagename eq sai2.exe" >>"%OUT%" 2>&1
>>"%OUT%" echo [sai2_bridge.exe 是否运行]
tasklist /fi "imagename eq sai2_bridge.exe" >>"%OUT%" 2>&1
>>"%OUT%" echo.

>>"%OUT%" echo ---- 自检（不开窗口，只验证程序本身能跑）----
sai2_bridge.exe --selftest >>"%OUT%" 2>&1
>>"%OUT%" echo [--selftest 退出码: !errorlevel!]
>>"%OUT%" echo.

>>"%OUT%" echo ---- 启动尝试 ----
start "" "sai2_bridge.exe"
timeout /t 4 /nobreak >nul
tasklist /fi "imagename eq sai2_bridge.exe" 2>nul | find /i "sai2_bridge.exe" >nul
if errorlevel 1 (
    >>"%OUT%" echo [结果] 启动后 4 秒内进程不存在 —— 程序启动失败（崩溃或被拦）
) else (
    >>"%OUT%" echo [结果] 进程已启动
    >>"%OUT%" echo [窗口] 如果看不到窗口，检查任务栏，或在任务管理器里结束它重试
)
>>"%OUT%" echo.

>>"%OUT%" echo ---- 日志（logs\bridge.log 最后 40 行）----
if exist "logs\bridge.log" (
    powershell -NoProfile -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-Content -LiteralPath 'logs\bridge.log' -Tail 40 -Encoding UTF8 | Add-Content -LiteralPath '%OUT%' -Encoding UTF8" 2>&1
) else (
    >>"%OUT%" echo （没有 logs\bridge.log —— 说明程序在写日志之前就退出了）
)
>>"%OUT%" echo.

>>"%OUT%" echo ==== 诊断结束 ====

echo.
echo   诊断完成：诊断.txt
echo   把这个文件发回来即可。
echo.
start "" notepad "%OUT%"
pause
