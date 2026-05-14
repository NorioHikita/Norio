@echo off
chcp 65001 >nul
title Realtime Interpreter

echo.
echo  ========================================
echo    Realtime Interpreter 🇯🇵 ^<-^> 🇺🇸
echo  ========================================
echo.

:: Node.js チェック
node -v >nul 2>&1
if errorlevel 1 (
    echo [エラー] Node.js がインストールされていません。
    echo.
    echo  以下のURLからNode.js LTS版をインストールしてください:
    echo  https://nodejs.org/ja/
    echo.
    pause
    exit /b 1
)

:: 初回のみ npm install
if not exist "node_modules" (
    echo [初回セットアップ] パッケージをインストール中...
    echo  （2〜3分かかる場合があります）
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [エラー] インストールに失敗しました。
        echo  インターネット接続を確認して再度実行してください。
        pause
        exit /b 1
    )
    echo.
    echo [完了] インストールが完了しました。
    echo.
)

:: ブラウザを自動で開く（少し待ってから）
ping -n 3 127.0.0.1 >nul
start "" "http://localhost:5173"

echo  アプリを起動しています...
echo  ブラウザで http://localhost:5173 が開きます
echo.
echo  ※ 終了するにはこのウィンドウを閉じるか Ctrl+C を押してください
echo.
call npm run dev

pause
