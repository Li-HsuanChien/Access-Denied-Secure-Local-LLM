<#
.SYNOPSIS
  Download the official llama.cpp Windows build into .\bin (run this on a machine WITH internet, then copy the folder).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\fetch_runtime.ps1                 # pinned build from models\shortlist.json
  powershell -ExecutionPolicy Bypass -File scripts\windows\fetch_runtime.ps1 -Tag latest
  powershell -ExecutionPolicy Bypass -File scripts\windows\fetch_runtime.ps1 -Tag b6500 -Variant cpu-x64
#>
param(
  [string]$Tag = "",                  # a release tag like b6500, "latest", or empty for the pinned tag
  [string]$Variant = "cpu-x64",       # cpu-x64 (reference laptop), vulkan-x64, cuda-12.4-x64 ...
  [string]$Dest = (Join-Path $PSScriptRoot "..\..\bin")
)
$ErrorActionPreference = "Stop"
if (-not $Tag) {
  $manifest = Get-Content (Join-Path $PSScriptRoot "..\..\models\shortlist.json") -Raw | ConvertFrom-Json
  $Tag = if ($manifest.llama_cpp.tag) { $manifest.llama_cpp.tag } else { "latest" }
}
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$headers = @{ "User-Agent" = "docqa-runtime" }
$pattern = "*bin-win-$Variant.zip"
Write-Host "Looking up llama.cpp release ($Tag)..."
if ($Tag -eq "latest") {
  # The numbered builds (b1234) are published as pre-releases and the "latest" release may carry no binaries,
  # so take the newest release that actually has the wanted Windows build.
  $releases = Invoke-RestMethod -Uri "https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=30" -Headers $headers
  $rel = $releases | Where-Object { -not $_.draft -and ($_.assets | Where-Object { $_.name -like $pattern }) } | Select-Object -First 1
  if (-not $rel) { throw "None of the 30 newest llama.cpp releases has a '$pattern' asset. Pass -Tag <tag> explicitly." }
} else {
  $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/$Tag" -Headers $headers
}
$asset = $rel.assets | Where-Object { $_.name -like $pattern } | Select-Object -First 1
if (-not $asset) {
  $names = ($rel.assets | ForEach-Object { $_.name }) -join "`n  "
  throw "No asset matching '$pattern' in $($rel.tag_name). Available:`n  $names"
}
$tmp = Join-Path $env:TEMP $asset.name
Write-Host "Downloading $($asset.name) ($([math]::Round($asset.size / 1MB)) MB)..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $tmp -UseBasicParsing

New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Expand-Archive -Path $tmp -DestinationPath $Dest -Force
# Some releases nest the binaries in a sub-folder; flatten so bin\llama-server.exe exists.
$server = Get-ChildItem -Path $Dest -Recurse -Filter "llama-server.exe" | Select-Object -First 1
if (-not $server) { throw "llama-server.exe not found after extracting $($asset.name)" }
if ($server.DirectoryName -ne (Resolve-Path $Dest).Path) {
  Get-ChildItem $server.DirectoryName | Move-Item -Destination $Dest -Force
}
Get-ChildItem -Path $Dest -Recurse | Unblock-File
Set-Content -Path (Join-Path $Dest "LLAMA_CPP_VERSION.txt") -Value "$($rel.tag_name) $($asset.name)"
Remove-Item $tmp -Force
Write-Host "Installed llama.cpp $($rel.tag_name) into $((Resolve-Path $Dest).Path)"
& (Join-Path $Dest "llama-server.exe") --version
