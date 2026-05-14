# Realtime Interpreter パッケージ作成スクリプト
# PowerShellで実行: .\create-package.ps1

$AppName = "realtime-interpreter"
$OutputZip = "$AppName.zip"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Realtime Interpreter パッケージ作成" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 除外するフォルダ・ファイル
$Excludes = @(
    "node_modules",
    "dist",
    ".git",
    $OutputZip,
    "create-package.ps1"
)

# 既存のZIPを削除
if (Test-Path $OutputZip) {
    Remove-Item $OutputZip -Force
    Write-Host "[削除] 既存の $OutputZip を削除しました" -ForegroundColor Yellow
}

# ファイル収集
$Files = Get-ChildItem -Path . -Recurse | Where-Object {
    $item = $_
    $excluded = $false
    foreach ($ex in $Excludes) {
        if ($item.FullName -match [regex]::Escape("\$ex")) {
            $excluded = $true
            break
        }
    }
    -not $excluded -and -not $item.PSIsContainer
}

Write-Host "[収集] $($Files.Count) ファイルをパッケージに含めます" -ForegroundColor Green

# ZIP作成
Compress-Archive -Path . -DestinationPath $OutputZip -CompressionLevel Optimal -Force

# node_modules と dist を除外するため、一度展開して再圧縮
$TempDir = "$AppName-temp"
if (Test-Path $TempDir) { Remove-Item $TempDir -Recurse -Force }

Expand-Archive -Path $OutputZip -DestinationPath $TempDir -Force
Remove-Item $OutputZip -Force

# 除外フォルダを削除
foreach ($ex in $Excludes) {
    $path = Join-Path $TempDir $ex
    if (Test-Path $path) {
        Remove-Item $path -Recurse -Force
        Write-Host "[除外] $ex" -ForegroundColor Gray
    }
}

# 再圧縮
$SourcePath = Join-Path $TempDir "*"
Compress-Archive -Path $SourcePath -DestinationPath $OutputZip -CompressionLevel Optimal
Remove-Item $TempDir -Recurse -Force

$ZipSize = [math]::Round((Get-Item $OutputZip).Length / 1KB, 0)

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  完了！" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  出力ファイル: $OutputZip ($ZipSize KB)" -ForegroundColor White
Write-Host ""
Write-Host "  配布手順:" -ForegroundColor White
Write-Host "  1. $OutputZip を同僚に送付（メール・Teamsなど）" -ForegroundColor Gray
Write-Host "  2. 受け取った側はZIPを展開" -ForegroundColor Gray
Write-Host "  3. README.md の手順に従ってセットアップ" -ForegroundColor Gray
Write-Host "  4. start.bat をダブルクリックで起動" -ForegroundColor Gray
Write-Host ""
