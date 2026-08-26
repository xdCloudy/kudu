$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repoRoot = Split-Path -Parent $PSScriptRoot
$localAiRoot = Join-Path $repoRoot 'resources\local-ai'
$modelDir = Join-Path $localAiRoot 'models'
$runtimeDir = Join-Path $localAiRoot 'runtime'
$licenseDir = Join-Path $localAiRoot 'licenses'

$modelFile = Join-Path $modelDir 'MiniCPM5-1B-Q4_K_M.gguf'
$modelUrl = 'https://huggingface.co/openbmb/MiniCPM5-1B-GGUF/resolve/main/MiniCPM5-1B-Q4_K_M.gguf?download=true'
$modelSha256 = '81B64D05A23B17B34C475F42B3E72FBDE62D4B92CC34541F7A8031D0752DEAFA'

$llamaRuntimeUrl = 'https://github.com/ggml-org/llama.cpp/releases/download/b10621/llama-b10621-bin-win-cpu-x64.zip'
$llamaRuntimeSha256 = '0E8B65E650E369F70F8307D890508886F171EF4FB00FACCCDDD4A1B7FFDACA51'

New-Item -ItemType Directory -Force -Path $modelDir, $runtimeDir, $licenseDir | Out-Null

# Use .NET directly instead of Get-FileHash. Some Windows environments still
# resolve npm's `powershell` executable to a host where Get-FileHash is absent.
# This works on both legacy Windows PowerShell and PowerShell 7.
function Get-Sha256Hex([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try {
            $bytes = $sha.ComputeHash($stream)
            return ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToUpperInvariant()
        } finally {
            $sha.Dispose()
        }
    } finally {
        $stream.Dispose()
    }
}

function Test-ExpectedHash([string]$Path, [string]$Expected) {
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    $actual = Get-Sha256Hex $Path
    return $actual -eq $Expected.ToUpperInvariant()
}

$tmpModel = "$modelFile.download"
if (-not (Test-ExpectedHash $modelFile $modelSha256)) {
    # A previous run may have completed the 688 MB download and then failed
    # while hashing it. Reuse that verified .download file instead of fetching
    # the whole model again.
    if (Test-ExpectedHash $tmpModel $modelSha256) {
        Write-Host 'Recovered previously downloaded MiniCPM model; checksum verified.'
        if (Test-Path -LiteralPath $modelFile) {
            Remove-Item -LiteralPath $modelFile -Force
        }
        Move-Item -LiteralPath $tmpModel -Destination $modelFile -Force
    } else {
        if (Test-Path -LiteralPath $modelFile) {
            Write-Host 'Existing MiniCPM model failed SHA256 verification; replacing it.'
            Remove-Item -LiteralPath $modelFile -Force
        }
        Remove-Item -LiteralPath $tmpModel -Force -ErrorAction SilentlyContinue

        Write-Host 'Downloading MiniCPM5-1B Q4_K_M (~688 MB)...'
        Invoke-WebRequest -Uri $modelUrl -OutFile $tmpModel -UseBasicParsing

        if (-not (Test-ExpectedHash $tmpModel $modelSha256)) {
            Remove-Item -LiteralPath $tmpModel -Force -ErrorAction SilentlyContinue
            throw 'MiniCPM model SHA256 verification failed.'
        }
        Move-Item -LiteralPath $tmpModel -Destination $modelFile -Force
    }
} else {
    Write-Host 'MiniCPM model already present and verified.'
}

$serverCandidates = @(
    (Join-Path $runtimeDir 'llama-server.exe'),
    (Join-Path $runtimeDir 'llama.exe')
)
$haveRuntime = $false
foreach ($candidate in $serverCandidates) {
    if (Test-Path -LiteralPath $candidate) { $haveRuntime = $true; break }
}

if (-not $haveRuntime) {
    Write-Host 'Downloading pinned llama.cpp b10621 Windows CPU runtime (~18 MB)...'
    $tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("kudu-llama-" + [Guid]::NewGuid().ToString('N'))
    $zip = Join-Path $tempRoot 'llama.zip'
    $extract = Join-Path $tempRoot 'extract'
    New-Item -ItemType Directory -Force -Path $tempRoot, $extract | Out-Null

    try {
        Invoke-WebRequest -Uri $llamaRuntimeUrl -OutFile $zip -UseBasicParsing
        if (-not (Test-ExpectedHash $zip $llamaRuntimeSha256)) {
            throw 'llama.cpp runtime SHA256 verification failed.'
        }

        Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force

        $server = Get-ChildItem -LiteralPath $extract -Recurse -File -Filter 'llama-server.exe' | Select-Object -First 1
        if (-not $server) {
            $server = Get-ChildItem -LiteralPath $extract -Recurse -File -Filter 'llama.exe' | Select-Object -First 1
        }
        if (-not $server) {
            throw 'Downloaded llama.cpp archive did not contain llama-server.exe or llama.exe.'
        }

        # Keep the executable and all DLL/runtime siblings together.
        Remove-Item -LiteralPath $runtimeDir -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
        Copy-Item -Path (Join-Path $server.Directory.FullName '*') -Destination $runtimeDir -Recurse -Force
    } finally {
        Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Host 'llama.cpp runtime already present.'
}

if (-not ((Test-Path (Join-Path $runtimeDir 'llama-server.exe')) -or (Test-Path (Join-Path $runtimeDir 'llama.exe')))) {
    throw 'llama.cpp runtime preparation failed.'
}

# The packaged build redistributes both projects, so retain their upstream
# license notices beside the bundled model/runtime.
$licenseDownloads = @(
    @{
        Uri = 'https://raw.githubusercontent.com/OpenBMB/MiniCPM/main/LICENSE'
        OutFile = (Join-Path $licenseDir 'MiniCPM-APACHE-2.0.txt')
    },
    @{
        Uri = 'https://raw.githubusercontent.com/ggml-org/llama.cpp/master/LICENSE'
        OutFile = (Join-Path $licenseDir 'llama.cpp-MIT.txt')
    }
)
foreach ($license in $licenseDownloads) {
    Invoke-WebRequest -Uri $license.Uri -OutFile $license.OutFile -UseBasicParsing
}

Write-Host 'Local AI assets are ready.'
