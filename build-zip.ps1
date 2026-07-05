# Builds the Chrome Web Store ZIP with ALL runtime files.
# Guards against the "forgot core.js" class of bug: every <script src> in
# popup.html must be present in the file list, or the build aborts.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$out  = Join-Path (Split-Path $root) 'ai-stock-analyzer-store.zip'

# Runtime files that ship in the extension
$files = @(
  'manifest.json', 'popup.html', 'background.js', 'content.js', 'icons', 'fonts',
  'core.js', 'popup-charts.js', 'popup-analysis.js', 'popup-news.js',
  'popup-alerts.js', 'popup-chat.js', 'popup-portfolio.js', 'popup-lists.js', 'popup-share.js', 'popup.js'
)

# Sanity check: every script popup.html loads must be in $files
$html = Get-Content (Join-Path $root 'popup.html') -Raw
$scripts = [regex]::Matches($html, 'src="([^"]+\.js)"') | ForEach-Object { $_.Groups[1].Value }
foreach ($s in $scripts) {
  if ($files -notcontains $s) {
    Write-Host "BUILD ABORTED: popup.html loads '$s' but it's not in the ZIP file list." -ForegroundColor Red
    exit 1
  }
}

$paths = $files | ForEach-Object { Join-Path $root $_ }
Compress-Archive -Force -Path $paths -DestinationPath $out
$kb = [math]::Round((Get-Item $out).Length / 1KB, 1)
Write-Host "Built $out  ($kb KB) with: $($files -join ', ')" -ForegroundColor Green
