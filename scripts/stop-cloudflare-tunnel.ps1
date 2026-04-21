$ErrorActionPreference = 'Stop'

function Stop-ProcessOnPort {
  param(
    [Parameter(Mandatory = $true)]
    [int] $Port
  )

  $connections = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
    Where-Object { $_.State -eq 'Listen' -and $_.OwningProcess -gt 0 } |
    Select-Object -ExpandProperty OwningProcess -Unique

  if (-not $connections) {
    Write-Host "Nenhum processo ouvindo na porta ${Port}."
    return
  }

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

  if (-not $cloudflaredProcesses) {
    Write-Host 'Nenhum processo cloudflared em execucao.'
    return
  }

  foreach ($process in $cloudflaredProcesses) {
    try {
      Stop-Process -Id $process.Id -Force -ErrorAction Stop
      Write-Host "Encerrado cloudflared PID $($process.Id)"
    } catch {
      Write-Warning "Nao foi possivel encerrar o cloudflared PID $($process.Id): $($_.Exception.Message)"
    }
  }
}

Write-Host 'Encerrando backend local e tunel atual...'
Stop-ProcessOnPort -Port 3001
Stop-Cloudflared
Write-Host 'Finalizado.'
