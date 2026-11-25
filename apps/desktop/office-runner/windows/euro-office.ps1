# Euro-Office for NoteComplete on Windows (office-bridge.js; docs/TABLES-AND-OFFICE.md phase 6).
# The Document Server exists only for Linux, so it runs in its own WSL2 distribution made
# from the official image's layers. No Docker Desktop needed. NoteComplete starts and stops
# it with `wsl -d NoteComplete-EuroOffice …` itself; this script does the steps that need
# PowerShell: checking and enabling WSL2 (asks for administrator rights once, through UAC),
# importing the image, removing it.
#
# Output: one line of JSON on stdout per call, { ok, … }; exit code 0 on success.
#   -Action Check                 { ok, wsl, version2, distro, rebootNeeded }
#   -Action Enable                runs `wsl --install --no-distribution` elevated (UAC)
#   -Action Import -InstallDir D -BaseTar T -Layers "L1;L2;…" -ApplyScript S
#   -Action Remove                `wsl --unregister` (deletes the distribution's disk)
# UNTESTED on a real Windows machine (written on Linux; see the plan).
param(
  [Parameter(Mandatory = $true)][ValidateSet('Check', 'Enable', 'Import', 'Remove')][string]$Action,
  [string]$Distro = 'NoteComplete-EuroOffice',
  [string]$InstallDir = '',
  [string]$BaseTar = '',
  [string]$Layers = '',
  [string]$ApplyScript = ''
)
$ErrorActionPreference = 'Stop'
# wsl.exe writes UTF-16 to a pipe; read it as such.
[Console]::OutputEncoding = [System.Text.Encoding]::Unicode

function Say($obj) { $obj | ConvertTo-Json -Compress -Depth 4 | Write-Output }
function Wsl([string[]]$argv) {
  $out = & wsl.exe @argv 2>&1 | Out-String
  return @{ code = $LASTEXITCODE; text = ($out -replace "`0", '').Trim() }
}
# A Windows path as WSL sees it inside the distribution (C:\x\y -> /mnt/c/x/y).
function WslPath([string]$p) {
  $r = Wsl @('-d', $Distro, '-u', 'root', '--', 'wslpath', '-a', ($p -replace '\\', '/'))
  if ($r.code -ne 0) { throw "wslpath failed: $($r.text)" }
  return $r.text
}

try {
  switch ($Action) {
    'Check' {
      $wsl = [bool](Get-Command wsl.exe -ErrorAction SilentlyContinue)
      if (-not $wsl) { Say @{ ok = $true; wsl = $false; version2 = $false; distro = $false; rebootNeeded = $false }; exit 0 }
      $status = Wsl @('--status')
      # "wsl --status" fails (or asks to install) until the WSL feature is on; a pending
      # reboot shows up as the Virtual Machine Platform being enabled but not running.
      $version2 = ($status.code -eq 0)
      $list = Wsl @('--list', '--quiet')
      $distro = ($list.code -eq 0) -and (($list.text -split "`r?`n") -contains $Distro)
      $reboot = $false
      try {
        $vmp = Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -ErrorAction Stop
        $reboot = $vmp.RestartNeeded
      } catch { }
      Say @{ ok = $true; wsl = $true; version2 = $version2; distro = $distro; rebootNeeded = $reboot; status = $status.text }
    }
    'Enable' {
      # One UAC prompt: WSL itself plus the Virtual Machine Platform, no Linux distribution.
      $p = Start-Process -FilePath 'wsl.exe' -ArgumentList '--install', '--no-distribution' -Verb RunAs -Wait -PassThru
      # 3010: done, restart required.
      Say @{ ok = ($p.ExitCode -eq 0 -or $p.ExitCode -eq 3010); code = $p.ExitCode; rebootNeeded = ($p.ExitCode -eq 3010 -or $p.ExitCode -eq 0) }
      if ($p.ExitCode -ne 0 -and $p.ExitCode -ne 3010) { exit 1 }
    }
    'Import' {
      if (-not $InstallDir -or -not $BaseTar -or -not $ApplyScript) { throw 'Import needs -InstallDir, -BaseTar and -ApplyScript.' }
      New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
      $list = Wsl @('--list', '--quiet')
      if (($list.text -split "`r?`n") -contains $Distro) { Wsl @('--unregister', $Distro) | Out-Null }
      $r = Wsl @('--import', $Distro, $InstallDir, $BaseTar, '--version', '2')
      if ($r.code -ne 0) { throw "wsl --import failed: $($r.text)" }
      # The other layers, in order, applied inside the distribution (whiteouts handled there).
      $apply = WslPath $ApplyScript
      foreach ($layer in ($Layers -split ';' | Where-Object { $_ })) {
        $r = Wsl @('-d', $Distro, '-u', 'root', '--', 'sh', $apply, (WslPath $layer))
        if ($r.code -ne 0) { throw "Applying a layer failed: $($r.text)" }
      }
      Say @{ ok = $true; distro = $Distro }
    }
    'Remove' {
      $r = Wsl @('--terminate', $Distro)
      $r = Wsl @('--unregister', $Distro)
      Say @{ ok = ($r.code -eq 0); text = $r.text }
    }
  }
} catch {
  Say @{ ok = $false; error = $_.Exception.Message }
  exit 1
}
