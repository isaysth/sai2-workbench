@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   sai2工作台 {{VERSION}} 升级清理
echo ============================================
echo.
echo 说明：这一步只针对从很早版本（v0.1.0 及更早）直升的用户。
echo 已经是近期版本的用户不需要运行，直接关掉本窗口即可。
echo.

if not exist "resources\app.asar" (
  echo [错误] 没有找到 resources\app.asar
  echo.
  echo 请先把本压缩包解压到 sai2工作台 的安装目录
  echo 也就是能看到 "sai2工作台.exe" 的那一层，再运行本脚本。
  echo.
  pause
  exit /b 1
)

set /p GO=确实需要清理请输入 y 回车：
if /i not "%GO%"=="y" (
  echo 已跳过。
  pause
  exit /b 0
)

echo.
echo 正在删除早期已合并的旧插件目录...
for %%d in (thumb-image thumb-psd thumb-sai2 opener-sai2 opener-ps opener-csp launcher-float) do (
  if exist "resources\builtin-plugins\%%d" (
    echo   删除 %%d
    rd /s /q "resources\builtin-plugins\%%d"
  )
)

echo.
echo 清理完成。现在可以启动 sai2工作台了。
echo.
pause
