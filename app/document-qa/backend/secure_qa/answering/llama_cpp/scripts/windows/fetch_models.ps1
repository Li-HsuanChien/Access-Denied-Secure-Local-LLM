<#
.SYNOPSIS
  Download shortlisted GGUF models (models\shortlist.json) into .\models. Run on a machine WITH internet,
  then copy the models folder to the air-gapped laptop. Downloads resume if interrupted (BITS).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\windows\fetch_models.ps1                 # week2 set (2 quants)
  powershell -ExecutionPolicy Bypass -File scripts\windows\fetch_models.ps1 -Set shortlist
  powershell -ExecutionPolicy Bypass -File scripts\windows\fetch_models.ps1 -Model qwen3-4b-2507 -Quant Q5_K_M
#>
param(
  [string]$Set = "week2",
  [string]$Model = "",
  [string]$Quant = "",
  [string]$Dest = (Join-Path $PSScriptRoot "..\..\models")
)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$manifest = Get-Content (Join-Path $PSScriptRoot "..\..\models\shortlist.json") -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path $Dest | Out-Null

$wanted = @()
if ($Model) { $wanted += ,@($Model, $(if ($Quant) { $Quant } else { "Q4_K_M" })) }
else { $wanted = $manifest.sets.$Set; if (-not $wanted) { throw "Unknown set '$Set'. Sets: $($manifest.sets.PSObject.Properties.Name -join ', ')" } }

foreach ($pair in $wanted) {
  $key, $q = $pair[0], $pair[1]
  $c = $manifest.candidates | Where-Object { $_.key -eq $key }
  if (-not $c) { throw "Unknown model key '$key'" }
  $f = $c.files.$q
  if (-not $f) { throw "$key has no $q entry in shortlist.json" }
  $out = Join-Path $Dest $f.file
  $url = "https://huggingface.co/$($c.repo)/resolve/main/$($f.file)"
  if (Test-Path $out) { Write-Host "Already present: $($f.file)"; continue }
  Write-Host "Downloading $($c.name) $q (~$($f.approx_gb) GB) - licence: $($c.license)"
  Write-Host "  $url"
  try {
    Start-BitsTransfer -Source $url -Destination "$out.part" -DisplayName $f.file -Description $c.name
  } catch {
    Write-Host "  BITS unavailable ($($_.Exception.Message)); falling back to Invoke-WebRequest (no resume)"
    Invoke-WebRequest -Uri $url -OutFile "$out.part" -UseBasicParsing
  }
  # sanity check: GGUF magic + plausible size
  $fs = [IO.File]::OpenRead("$out.part"); $magic = New-Object byte[] 4; $null = $fs.Read($magic, 0, 4); $len = $fs.Length; $fs.Close()
  if ([Text.Encoding]::ASCII.GetString($magic) -ne "GGUF") { Remove-Item "$out.part"; throw "$($f.file) is not a GGUF file (moved or renamed on Hugging Face? check $url)" }
  if ($len -lt ($f.approx_gb * 0.7GB)) { Write-Warning "$($f.file) is smaller than expected ($([math]::Round($len/1GB,2)) GB) - it may be incomplete" }
  $hash = (Get-FileHash "$out.part" -Algorithm SHA256).Hash
  if ($f.sha256 -and $hash -ne $f.sha256.ToUpper()) {
    Remove-Item "$out.part"
    throw "$($f.file) SHA256 mismatch: got $hash, shortlist.json pins $($f.sha256.ToUpper()). The download is corrupt or the file changed upstream."
  }
  Move-Item "$out.part" $out -Force
  Add-Content -Path (Join-Path $Dest "SHA256SUMS.txt") -Value "$hash  $($f.file)"
  $check = if ($f.sha256) { "matches shortlist.json" } else { "not pinned - compare with the Hugging Face file page" }
  Write-Host "  ok  $([math]::Round($len/1GB,2)) GB  sha256 $hash ($check)"
}
Write-Host "`nDone. Files pinned in shortlist.json were verified; compare any others in SHA256SUMS.txt with the sha256 shown on their Hugging Face file page before moving them to the air-gapped machine."
