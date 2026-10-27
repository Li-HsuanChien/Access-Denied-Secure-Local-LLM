<#
.SYNOPSIS
  One-command launcher for the Secure Local DocQA web app (PowerShell version of start.cmd).

.DESCRIPTION
  Sets up the Python and frontend dependencies, then starts the dev host and the Open WebUI
  frontend and opens the browser. It asks whether to run the Quick demo (no downloads) or a
  real local model. Close this window or press Ctrl+C to stop everything.

  The llama.cpp runtime chat (the old behaviour) still lives at
    app\document-qa\backend\secure_qa\answering\llama_cpp\start.cmd

.EXAMPLE
  .\start.ps1
  powershell -ExecutionPolicy Bypass -File start.ps1        # if script execution is blocked
  .\start.ps1 --some-flag                                    # extra flags are forwarded to launch.py
#>
$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

# Resolve a Python launcher: prefer "py -3", else "python".
$py = $null
$pyArgs = @()
if (Get-Command py -ErrorAction SilentlyContinue) {
  $py = "py"; $pyArgs = @("-3")
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  $py = "python"
}

if (-not $py) {
  Write-Host ""
  Write-Host "Python was not found. Install Python 3.11+ from https://www.python.org/downloads/"
  Write-Host 'and tick "Add python.exe to PATH" during setup, then run this file again.'
  exit 1
}

& $py @pyArgs (Join-Path $PSScriptRoot "launch.py") @args
$code = $LASTEXITCODE
if ($code -ne 0) {
  Write-Host ""
  Write-Host "The launcher stopped with an error - read the message above."
}
exit $code
