# Hermes Agent + Web UI Watchdog
# Port-based health check, auto-restart on crash, crash log capture

$HermesExe = "C:\Users\guohu\AppData\Local\Python\pythoncore-3.14-64\Scripts\hermes.exe"
$PythonExe = "C:\Users\guohu\AppData\Local\Python\pythoncore-3.14-64\python.exe"
$WebUIRoot = "C:\Users\guohu\hermes-webui"
$LogDir = "$env:USERPROFILE\.hermes\logs"
$AgentDir = "C:\Users\guohu\AppData\Local\Python\pythoncore-3.14-64\Lib\site-packages"
$WatchdogLog = "$LogDir\watchdog.log"
$GatewayLog = "$LogDir\gateway-crash.log"
$WebUILog = "$LogDir\webui-crash.log"
$WatchdogLock = "$LogDir\watchdog.lock"

function log { param([string]$msg) $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"; "$ts $msg" | Out-File -FilePath $WatchdogLog -Append; Write-Host "$ts $msg" }

function Is-Port-Listening($port) {
    $result = netstat -ano | Select-String ":$port\s" | Select-String "LISTENING"
    return $result -ne $null
}

function Start-Gateway {
    log "[+] Starting Gateway..."
    if (Test-Path "$env:USERPROFILE\.hermes\gateway.lock") { Remove-Item "$env:USERPROFILE\.hermes\gateway.lock" -Force -ErrorAction SilentlyContinue }
    $env:HERMES_WEBUI_AGENT_DIR = $AgentDir
    Start-Process -FilePath $HermesExe -ArgumentList "gateway run" -WindowStyle Hidden -RedirectStandardError $GatewayLog
    $timeout = 30; $waited = 0
    while ($waited -lt $timeout) {
        if (Is-Port-Listening 8642) { log "[OK] Gateway is up on :8642"; return $true }
        Start-Sleep 1; $waited++
    }
    log "[!] Gateway failed to start within ${timeout}s"
    return $false
}

function Start-WebUI {
    log "[+] Starting Web UI..."
    $env:HERMES_WEBUI_AGENT_DIR = $AgentDir
    $env:HERMES_WEBUI_PORT = "8788"
    $env:HERMES_HOME = "$env:USERPROFILE\.hermes"
    $env:DEEPSEEK_API_KEY = "sk-1604dae8ea0e453ab7cd29a5e913db36"
    $env:OPENAI_API_KEY = "sk-1604dae8ea0e453ab7cd29a5e913db36"
    $env:XIAOMI_API_KEY = "tp-cj85shqsf2gyztxkm8940geewxwre15qdhvmkerkjs51r0du"
    Start-Process -FilePath $PythonExe -ArgumentList "server.py" -WorkingDirectory $WebUIRoot -WindowStyle Hidden -RedirectStandardError $WebUILog
    $timeout = 20; $waited = 0
    while ($waited -lt $timeout) {
        if (Is-Port-Listening 8788) { log "[OK] Web UI is up on :8788"; return $true }
        Start-Sleep 1; $waited++
    }
    log "[!] Web UI failed to start within ${timeout}s"
    return $false
}

# --- Prevent duplicate watchdog ---
if (Test-Path $WatchdogLock) {
    $oldPid = Get-Content $WatchdogLock
    if (Get-Process -Id $oldPid -ErrorAction SilentlyContinue) {
        log "[!] Watchdog already running (PID $oldPid). Exiting."
        exit
    }
    log "[.] Stale lock found (PID $oldPid). Removing."
    Remove-Item $WatchdogLock -Force
}
[System.IO.File]::WriteAllText($WatchdogLock, $PID)

log "=== Hermes Watchdog started (PID $PID) ==="
log "Gateway: $HermesExe | Web UI: $WebUIRoot\server.py"
log "Crash logs: $GatewayLog / $WebUILog"

# Initial start
Start-Gateway
Start-WebUI
log "http://localhost:8788"

# Monitor loop
while ($true) {
    $gwUp = Is-Port-Listening 8642
    $uiUp = Is-Port-Listening 8788

    if (-not $gwUp) {
        log "[!] Gateway is DOWN on :8642. Restarting..."
        Start-Gateway
    }
    if (-not $uiUp) {
        log "[!] Web UI is DOWN on :8788. Restarting..."
        Start-WebUI
    }
    Start-Sleep 15
}
