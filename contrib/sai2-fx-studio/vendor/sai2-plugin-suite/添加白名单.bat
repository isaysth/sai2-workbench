@echo off
rem ===========================================================================
rem 添加白名单.bat - 把本目录加入 Windows Defender 排除项
rem
rem 为什么需要：本套件要向 SAI2 注入一个只读观察 DLL（sai2_agent.dll），
rem 这类行为是杀软的重点关注对象。不加排除项可能被静默拦截，症状是
rem 「注入完成但面板一直未连接」。
rem
rem 360 / 火绒等第三方杀软不认这个脚本，请在各自的「信任区」手动添加本目录。
rem ===========================================================================
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem 需要管理员权限：没有就自提权（弹 UAC）后重跑一遍
net session >nul 2>&1
if errorlevel 1 (
    echo 需要管理员权限，正在请求提权（会弹出 UAC 确认框）…
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b 0
)

for %%I in ("%~dp0.") do set "APPDIR=%%~fI"

echo 正在把以下目录加入 Windows Defender 排除项：
echo   %APPDIR%
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$p='%APPDIR%'; try { Add-MpPreference -ExclusionPath $p -ErrorAction Stop; Write-Host '[完成] 已加入排除项，重启面板后生效' -ForegroundColor Green } catch { Write-Host '[失败] 未安装 Defender，或被安全策略/第三方杀软锁定' -ForegroundColor Yellow; Write-Host '       请手动把下面这个目录加入杀软的信任区：' -ForegroundColor Yellow; Write-Host ('       ' + $p) }"

echo.
echo 提示：如果之前注入失败过，请关掉面板重新运行「启动插件面板.bat」，
echo       并在面板里重新点一次「连接注入」。
echo.
pause
