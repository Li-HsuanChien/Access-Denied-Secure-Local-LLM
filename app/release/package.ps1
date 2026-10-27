param(
    [string]$Python = 'python',
    [switch]$SkipSetup,
    [switch]$OfflineAssets,
    [switch]$ChecksOnly,
    [switch]$SkipChecks,
    [switch]$SkipNativeTest,
    [switch]$Zip,
    [string]$Output = ''
)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$env:HF_HUB_OFFLINE = '1'
$env:TRANSFORMERS_OFFLINE = '1'
$env:ANONYMIZED_TELEMETRY = 'False'
$env:PYTHONUTF8 = '1'
function Invoke-BuildCommand {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Build command failed ($LASTEXITCODE): $Program" }
}
Push-Location $repoRoot
try {
    $buildPython = $Python
    if (-not $SkipSetup) {
        $buildEnv = Join-Path $PSScriptRoot 'build/package-venv'
        if (-not (Test-Path (Join-Path $buildEnv 'Scripts/python.exe'))) {
            Invoke-BuildCommand $Python @('-m', 'venv', $buildEnv)
        }
        $buildPython = Join-Path $buildEnv 'Scripts/python.exe'
        Invoke-BuildCommand $buildPython @('-m', 'pip', 'install', '-r', 'requirements.txt', '-r', 'app/release/requirements-build.txt', '-r', 'app/release/requirements-real.txt')
        Invoke-BuildCommand $buildPython @('-m', 'pip', 'install', '--no-deps', '-e', 'app/document-qa/backend/secure_qa/answering/llama_cpp')
        $env:CYPRESS_INSTALL_BINARY = '0'
        Invoke-BuildCommand 'npm.cmd' @('ci', '--prefix', 'app/document-qa/frontend')
        Invoke-BuildCommand 'npm.cmd' @('ci', '--prefix', 'app/desktop')
    }
    $buildArgs = @('-u', 'app/release/package.py')
    if ($OfflineAssets) { $buildArgs += '--offline-assets' }
    if ($ChecksOnly) { $buildArgs += '--checks-only' }
    if ($SkipChecks) { $buildArgs += '--skip-checks' }
    if ($SkipNativeTest) { $buildArgs += '--skip-native-test' }
    if ($Zip) { $buildArgs += '--zip' }
    if ($Output) { $buildArgs += @('--output', $Output) }
    Invoke-BuildCommand $buildPython $buildArgs
}
finally { Pop-Location }
