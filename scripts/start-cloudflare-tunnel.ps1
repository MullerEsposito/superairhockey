$ErrorActionPreference = 'Stop'

function Stop-ProcessOnPort {
  param(
    [Parameter(Mandatory = $true)]
    [int] $Port
  )

  $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
    Where-Object { $_.State -eq 'Listen' -and $_.OwningProcess -gt 0 } |
    Select-Object -ExpandProperty OwningProcess -Unique

  foreach ($processId in $connections) {
    try {
      Stop-Process -Id $processId -Force -ErrorAction Stop
      Write-Host "Encerrado processo na porta ${Port}: PID $processId"
    } catch {
      Write-Warning "Nao foi possivel encerrar o PID ${processId} na porta ${Port}: $($_.Exception.Message)"
    }
  }
}

function Stop-Cloudflared {
  $cloudflaredProcesses = Get-Process -Name cloudflared -ErrorAction SilentlyContinue
  foreach ($process in $cloudflaredProcesses) {
    try {
      Stop-Process -Id $process.Id -Force -ErrorAction Stop
      Write-Host "Encerrado cloudflared PID $($process.Id)"
    } catch {
      Write-Warning "Nao foi possivel encerrar o cloudflared PID $($process.Id): $($_.Exception.Message)"
    }
  }
}

function Start-LoggedProcess {
  param(
    [Parameter(Mandatory = $true)]
    [string] $FilePath,
    [Parameter(Mandatory = $true)]
    [string[]] $ArgumentList,
    [Parameter(Mandatory = $true)]
    [string] $StdOutPath,
    [Parameter(Mandatory = $true)]
    [string] $StdErrPath,
    [hashtable] $Environment
  )

  $resolvedFilePath = $FilePath
  $resolvedArgumentList = @($ArgumentList)

  if ($Environment -and $Environment.Count -gt 0) {
    $setStatements = @()
    foreach ($key in $Environment.Keys) {
      $value = [string] $Environment[$key]
      $escapedValue = $value.Replace('"', '\"')
      $setStatements += "set `"$key=$escapedValue`""
    }

    $commandParts = @($FilePath) + $ArgumentList
    $commandText = ($commandParts | ForEach-Object {
      if ($_ -match '[\s"]') {
        '"' + ($_ -replace '"', '\"') + '"'
      } else {
        $_
      }
    }) -join ' '

    $resolvedFilePath = 'cmd.exe'
    $resolvedArgumentList = @('/c', (($setStatements -join ' && ') + ' && ' + $commandText))
  }

  $startInfo = @{
    FilePath               = $resolvedFilePath
    ArgumentList           = $resolvedArgumentList
    WorkingDirectory       = (Get-Location)
    WindowStyle            = 'Hidden'
    RedirectStandardOutput = $StdOutPath
    RedirectStandardError  = $StdErrPath
    PassThru               = $true
  }

  Start-Process @startInfo
}

function Wait-ForPort {
  param(
    [Parameter(Mandatory = $true)]
    [int] $Port,
    [int] $TimeoutSeconds = 20
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $isListening = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
      Where-Object { $_.State -eq 'Listen' -and $_.OwningProcess -gt 0 } |
      Select-Object -First 1

    if ($isListening) {
      return $true
    }

    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  return $false
}

function Wait-ForTunnelUrl {
  param(
    [Parameter(Mandatory = $true)]
    [string] $LogPath,
    [int] $TimeoutSeconds = 30
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $pattern = 'https://[a-z0-9-]+\.trycloudflare\.com'

  do {
    if (Test-Path -LiteralPath $LogPath) {
      $match = Select-String -Path $LogPath -Pattern $pattern -AllMatches -ErrorAction SilentlyContinue |
        Select-Object -Last 1

      if ($match) {
        return $match.Matches[-1].Value
      }
    }

    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)

  return $null
}

function New-RunLogPaths {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Root
  )

  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $logDir = Join-Path $Root 'logs'
  if (-not (Test-Path -LiteralPath $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
  }

  return @{
    ServerLog        = Join-Path $logDir "server-$timestamp.log"
    ServerErrLog     = Join-Path $logDir "server-$timestamp.err.log"
    BootstrapLog     = Join-Path $logDir "server-bootstrap-$timestamp.log"
    BootstrapErrLog  = Join-Path $logDir "server-bootstrap-$timestamp.err.log"
    CloudflaredLog   = Join-Path $logDir "cloudflared-$timestamp.log"
    CloudflaredErrLog = Join-Path $logDir "cloudflared-$timestamp.err.log"
  }
}

$root = Get-Location
$logs = New-RunLogPaths -Root $root

Write-Host 'Gerando build do frontend...'
npm run build

Write-Host 'Limpando processos anteriores...'
Stop-ProcessOnPort -Port 3001
Stop-Cloudflared
Start-Sleep -Seconds 1

Write-Host 'Subindo backend local em HTTP...'
$bootstrapProcess = Start-LoggedProcess `
  -FilePath 'npm' `
  -ArgumentList @('run', 'dev') `
  -StdOutPath $logs.BootstrapLog `
  -StdErrPath $logs.BootstrapErrLog `
  -Environment @{ DISABLE_HTTPS = '1' }

if (-not (Wait-ForPort -Port 3001)) {
  throw "O backend nao abriu a porta 3001 a tempo. Verifique $($logs.BootstrapLog) e $($logs.BootstrapErrLog)."
}

Write-Host 'Abrindo Quick Tunnel do Cloudflare...'
$cloudflaredProcess = Start-LoggedProcess `
  -FilePath 'cloudflared' `
  -ArgumentList @('tunnel', '--url', 'http://localhost:3001') `
  -StdOutPath $logs.CloudflaredLog `
  -StdErrPath $logs.CloudflaredErrLog

$publicUrl = Wait-ForTunnelUrl -LogPath $logs.CloudflaredErrLog
if (-not $publicUrl) {
  throw "Nao foi possivel capturar a URL publica do Cloudflare. Verifique $($logs.CloudflaredErrLog)."
}

Write-Host "Tunnel criado em: $publicUrl"
Write-Host 'Reiniciando backend com PUBLIC_APP_URL...'

try {
  Stop-Process -Id $bootstrapProcess.Id -Force -ErrorAction Stop
} catch {
  Write-Warning "Nao foi possivel encerrar o backend temporario PID $($bootstrapProcess.Id): $($_.Exception.Message)"
}

Start-Sleep -Seconds 1

$serverProcess = Start-LoggedProcess `
  -FilePath 'npm' `
  -ArgumentList @('run', 'dev') `
  -StdOutPath $logs.ServerLog `
  -StdErrPath $logs.ServerErrLog `
  -Environment @{
    DISABLE_HTTPS = '1'
    PUBLIC_APP_URL = $publicUrl
  }

if (-not (Wait-ForPort -Port 3001)) {
  throw "O backend reiniciado nao abriu a porta 3001 a tempo. Verifique $($logs.ServerLog) e $($logs.ServerErrLog)."
}

Write-Host ''
Write-Host 'Tudo pronto.'
Write-Host "Host local: http://localhost:3001/host"
Write-Host "Controller remoto: $publicUrl/controller"
Write-Host ''
Write-Host "PID backend: $($serverProcess.Id)"
Write-Host "PID cloudflared: $($cloudflaredProcess.Id)"
Write-Host 'Logs desta execucao:'
Write-Host "  $($logs.ServerLog)"
Write-Host "  $($logs.ServerErrLog)"
Write-Host "  $($logs.BootstrapLog)"
Write-Host "  $($logs.BootstrapErrLog)"
Write-Host "  $($logs.CloudflaredLog)"
Write-Host "  $($logs.CloudflaredErrLog)"
