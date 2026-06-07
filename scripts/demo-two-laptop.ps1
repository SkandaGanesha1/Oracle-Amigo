# Two-Laptop Demo Launcher (PowerShell / Windows)
#
# Starts the control plane + two local agents on one machine for the
# A2A v1.0.0 + ANP hardening demo. Useful when you don't have two laptops
# handy; for a real cross-device run see docs/two-laptop-deployment.md.
#
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\demo-two-laptop.ps1
#
# Requires: Node.js 20+, PowerShell 5.1+ (built into Windows 10/11)
# Optional: the `jq` CLI for pretty-printed smoke checks (script falls back
#           to raw output if jq is missing).

[CmdletBinding()]
param(
    [int]$ControlPlanePort = 8080,
    [int]$AgentAPort = 3399,
    [int]$AgentBPort = 3400,
    [switch]$SkipSmokeChecks
)

$ErrorActionPreference = "Stop"
$ROOT = (Resolve-Path "$PSScriptRoot\..").Path
Set-Location $ROOT

# Persist generated secrets so the agents can read them
$secretDir = Join-Path $ROOT ".demo-secrets"
if (-not (Test-Path $secretDir)) { New-Item -ItemType Directory -Path $secretDir | Out-Null }
$envFile = Join-Path $secretDir "env"

function New-Secret([int]$bytes = 32) {
    $b = New-Object byte[] $bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    -join ($b | ForEach-Object { $_.ToString("x2") })
}

# Reuse secrets from the previous run if present
if (Test-Path $envFile) {
    Write-Host "==> Reusing secrets from $envFile"
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^\s*([^=]+)=(.*)$") { Set-Item -Path "Env:\$($Matches[1])" -Value $Matches[2] }
    }
} else {
    $env:JWT_ACCESS_SECRET = New-Secret
    $env:JWT_REFRESH_SECRET = New-Secret
    $env:DEV_ADMIN_TOKEN = New-Secret 16
    @(
        "JWT_ACCESS_SECRET=$env:JWT_ACCESS_SECRET",
        "JWT_REFRESH_SECRET=$env:JWT_REFRESH_SECRET",
        "DEV_ADMIN_TOKEN=$env:DEV_ADMIN_TOKEN",
        "CONTROL_PLANE_PORT=$ControlPlanePort",
        "CONTROL_PLANE_PUBLIC_URL=http://127.0.0.1:$ControlPlanePort",
        "AGENT_A_PORT=$AgentAPort",
        "AGENT_B_PORT=$AgentBPort"
    ) | Set-Content -Path $envFile
}

$env:CONTROL_PLANE_PORT = "$ControlPlanePort"
$env:CONTROL_PLANE_HOST = "127.0.0.1"
$env:CONTROL_PLANE_PUBLIC_URL = "http://127.0.0.1:$ControlPlanePort"
$env:DEFAULT_ORG_SLUG = "demo-org"

function Wait-ForUrl {
    param([string]$Url, [string]$Label, [int]$Attempts = 60)
    for ($i = 0; $i -lt $Attempts; $i++) {
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2 -ErrorAction Stop
            if ($r.StatusCode -lt 500) {
                Write-Host "    $Label is up"
                return $true
            }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    Write-Host "    $Label failed to become ready"
    return $false
}

# Track child PIDs for cleanup
$script:cpJob = $null
$script:agentAJob = $null
$script:agentBJob = $null

$cleanup = {
    Write-Host ""
    Write-Host "==> Shutting down"
    if ($script:cpJob) { Stop-Job -Job $script:cpJob -ErrorAction SilentlyContinue; Remove-Job -Job $script:cpJob -ErrorAction SilentlyContinue }
    if ($script:agentAJob) { Stop-Job -Job $script:agentAJob -ErrorAction SilentlyContinue; Remove-Job -Job $script:agentAJob -ErrorAction SilentlyContinue }
    if ($script:agentBJob) { Stop-Job -Job $script:agentBJob -ErrorAction SilentlyContinue; Remove-Job -Job $script:agentBJob -ErrorAction SilentlyContinue }
}
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action $cleanup | Out-Null
trap { & $cleanup; break }

Write-Host "==> Building control plane"
npm run build:control-plane --silent
if ($LASTEXITCODE -ne 0) { throw "control plane build failed" }

Write-Host "==> Starting control plane on port $ControlPlanePort"
$cpLog = Join-Path $secretDir "cp.log"
$script:cpJob = Start-Job -ScriptBlock {
    param($root, $logPath)
    Set-Location $root
    node apps/control-plane/dist/main.js *>&1 | Tee-Object -FilePath $logPath
} -ArgumentList $ROOT, $cpLog
if (-not (Wait-ForUrl -Url "http://127.0.0.1:$ControlPlanePort/health" -Label "control plane")) {
    Get-Content $cpLog -Tail 30
    throw "control plane failed to start"
}

Write-Host "==> Starting agent A on port $AgentAPort"
$agentALog = Join-Path $secretDir "agent-a.log"
$env:AGENTIC_PORT = "$AgentAPort"
$env:AGENTIC_CONTROL_PLANE_URL = $env:CONTROL_PLANE_PUBLIC_URL
$env:AGENTIC_TENANT = $env:DEFAULT_ORG_SLUG
$script:agentAJob = Start-Job -ScriptBlock {
    param($root, $logPath, $cpUrl, $port, $tenant)
    $env:AGENTIC_CONTROL_PLANE_URL = $cpUrl
    $env:AGENTIC_PORT = $port
    $env:AGENTIC_TENANT = $tenant
    Set-Location $root
    npm start --silent *>&1 | Tee-Object -FilePath $logPath
} -ArgumentList $ROOT, $agentALog, $env:CONTROL_PLANE_PUBLIC_URL, $AgentAPort, $env:DEFAULT_ORG_SLUG

Write-Host "==> Starting agent B on port $AgentBPort"
$agentBLog = Join-Path $secretDir "agent-b.log"
$script:agentBJob = Start-Job -ScriptBlock {
    param($root, $logPath, $cpUrl, $port, $tenant)
    $env:AGENTIC_CONTROL_PLANE_URL = $cpUrl
    $env:AGENTIC_PORT = $port
    $env:AGENTIC_TENANT = $tenant
    Set-Location $root
    npm start --silent *>&1 | Tee-Object -FilePath $logPath
} -ArgumentList $ROOT, $agentBLog, $env:CONTROL_PLANE_PUBLIC_URL, $AgentBPort, $env:DEFAULT_ORG_SLUG

if (-not (Wait-ForUrl -Url "http://127.0.0.1:$AgentAPort/.well-known/agent-card.json" -Label "agent A")) {
    Get-Content $agentALog -Tail 30
    throw "agent A failed to start"
}
if (-not (Wait-ForUrl -Url "http://127.0.0.1:$AgentBPort/.well-known/agent-card.json" -Label "agent B")) {
    Get-Content $agentBLog -Tail 30
    throw "agent B failed to start"
}

if (-not $SkipSmokeChecks) {
    Write-Host ""
    Write-Host "==> Smoke checks"
    Write-Host "  - control plane /health:"
    try { (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$ControlPlanePort/health").Content } catch {}

    Write-Host ""
    Write-Host "  - agent A A2A v1 card:"
    try { (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$AgentAPort/.well-known/agent-card.json").Content } catch {}

    Write-Host ""
    Write-Host "  - agent B A2A v1 card:"
    try { (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$AgentBPort/.well-known/agent-card.json").Content } catch {}

    Write-Host ""
    Write-Host "  - control plane admin: list users"
    try {
        (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$ControlPlanePort/admin/users" -Headers @{ "X-Admin-Token" = $env:DEV_ADMIN_TOKEN }).Content
    } catch {}
}

Write-Host ""
Write-Host "==> Demo is live. Secrets saved to $envFile (don't commit)."
Write-Host "   Control plane: http://127.0.0.1:$ControlPlanePort  (logs: $cpLog)"
Write-Host "   Agent A:       http://127.0.0.1:$AgentAPort  (logs: $agentALog)"
Write-Host "   Agent B:       http://127.0.0.1:$AgentBPort  (logs: $agentBLog)"
Write-Host ""
Write-Host "Press Ctrl+C to stop all three processes."

# Block forever; the trap/cleanup will fire on Ctrl+C
while ($true) { Start-Sleep -Seconds 1 }
