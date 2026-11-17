@echo off
rem ===========================================================================
rem 启动插件面板.bat - 双击即可启动 sai2_bridge.exe
rem
rem 注意：
rem   * 本文件必须和 sai2_bridge.exe、plugins\ 放在同一目录（发布包就是这样摆的）
rem   * SAI2 以管理员身份运行时，本面板也必须以管理员身份启动，否则「连接注入」
rem     会因权限级别不一致被系统拒绝（面板内也有「管理员重启」按钮）
rem   * 控制台窗口闪一下就消失是**正常**的：面板是独立进程。窗口没出现才是问题，
rem     这时本脚本会停下来告诉你原因。
rem   * 行尾必须是 CRLF：cmd.exe 对纯 LF 的批处理会解析错乱
rem ===========================================================================
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

if not exist "sai2_bridge.exe" (
    echo.
    echo   [错误] 当前目录下找不到 sai2_bridge.exe
    echo          本脚本要和 sai2_bridge.exe 放在同一目录。
    echo          如果你是在压缩包里直接双击的：先右键压缩包 -^> 「全部解压缩」。
    echo.
    pause
    exit /b 1
)

rem 解除「来自 Internet」标记：被标记的文件会被 SmartScreen / 杀软静默拦下
powershell -NoProfile -Command "Get-ChildItem -LiteralPath '%~dp0' -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue" >nul 2>&1

if not exist "plugins\" (
    echo   [警告] 找不到 plugins 目录：功能按钮会全部不可用，请确认解压完整。
    echo.
)

rem 已经有实例在跑时，新进程会自己退出（单实例）——先说明，避免误判
tasklist /fi "imagename eq sai2_bridge.exe" 2>nul | find /i "sai2_bridge.exe" >nul
if not errorlevel 1 (
    echo   [提示] 检测到已经有一个面板进程在运行。
    echo          如果看不到它的窗口：在任务栏找一下，或者用任务管理器结束
    echo          sai2_bridge.exe 之后再运行本脚本。
    echo.
)

start "" "sai2_bridge.exe"
timeout /t 3 /nobreak >nul

tasklist /fi "imagename eq sai2_bridge.exe" 2>nul | find /i "sai2_bridge.exe" >nul
if errorlevel 1 (
    echo.
    echo   [失败] 面板进程没有起来，或者起来后立刻退出了。
    echo.
    echo   按顺序排查：
    echo     1^) 压缩包没解压，直接在 zip 里双击    -^> 先「全部解压缩」
    echo     2^) 杀毒软件拦截（360 / 火绒 / Defender） -^> 右键「添加白名单.bat」以管理员运行
    echo     3^) 文件被 SmartScreen 拦下              -^> 右键 sai2_bridge.exe -^> 属性 -^> 解除锁定
    echo     4^) Windows 10 N 版缺少 Media Foundation -^> 安装 Media Feature Pack
    echo     5^) 缺少 VC/UCRT 运行库                  -^> 装一遍「Microsoft Visual C++ 运行库合集」
    echo.
    echo   想看详细原因：关掉这个窗口，双击「诊断.bat」，把生成的 诊断.txt 发回来。
    echo.
    pause
    exit /b 1
)

exit /b 0
