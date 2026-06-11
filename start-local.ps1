$ErrorActionPreference = 'Stop'

$projectRoot = 'C:\Users\NETLATIN SOPORTE\Desktop\automatizacion correos'
$frontendRoot = Join-Path $projectRoot 'frontend'
$nodePath = 'C:\Users\NETLATIN SOPORTE\AppData\Local\Programs\nodejs-lts\node-v22.22.3-win-x64\node.exe'

if (-not (Test-Path $nodePath)) {
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCmd) {
    throw 'No se encontro Node.js. Instalalo o ajusta $nodePath en start-local.ps1.'
  }
  $nodePath = $nodeCmd.Source
}

# Stop previous listeners to avoid EADDRINUSE and stale processes.
$ports = @(3001, 5173)
foreach ($port in $ports) {
  $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}

Start-Process -FilePath $nodePath -ArgumentList '.\backend\index.js' -WorkingDirectory $projectRoot
Start-Process -FilePath $nodePath -ArgumentList '.\node_modules\vite\bin\vite.js --host localhost --port 5173' -WorkingDirectory $frontendRoot

Start-Sleep -Seconds 4

$backend = Invoke-WebRequest -Uri 'http://localhost:3001/health' -UseBasicParsing
$frontend = Invoke-WebRequest -Uri 'http://localhost:5173/' -UseBasicParsing

Write-Output "Backend: $($backend.StatusCode) $($backend.Content)"
Write-Output "Frontend: $($frontend.StatusCode)"
Write-Output 'Abre: http://localhost:5173/'
