# Starts ComfyUI (backend) and the Sunprint studio together and stops them together.
# Run through Sunprint.bat. Everything this window starts ends when the window closes.
param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
# ComfyUI lives next to this file unless SUNPRINT_COMFYUI points somewhere else.
$comfyDir = if ($env:SUNPRINT_COMFYUI) { $env:SUNPRINT_COMFYUI } else { Join-Path $root 'ComfyUI' }
$studioDir = Join-Path $root 'studio'
$logDir = Join-Path $root 'logs'
New-Item -ItemType Directory -Force $logDir | Out-Null
$Host.UI.RawUI.WindowTitle = 'Sunprint'

$comfyUrl = 'http://127.0.0.1:8188'
$studioUrl = 'http://127.0.0.1:5173'

# Put this window in a Windows job object that kills its members when it closes. Processes
# started from here join it automatically, so ComfyUI and the studio can't outlive the window.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class SunprintJob {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
  [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [StructLayout(LayoutKind.Sequential)] struct Basic { public long UserTime; public long JobUserTime; public uint LimitFlags; public UIntPtr MinWs; public UIntPtr MaxWs; public uint ActiveProcesses; public UIntPtr Affinity; public uint Priority; public uint Scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong A, B, C, D, E, F; }
  [StructLayout(LayoutKind.Sequential)] struct Extended { public Basic Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory; }
  static IntPtr job;
  public static bool Join() {
    job = CreateJobObject(IntPtr.Zero, null);
    var info = new Extended();
    info.Basic.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    int length = Marshal.SizeOf(typeof(Extended));
    IntPtr ptr = Marshal.AllocHGlobal(length);
    Marshal.StructureToPtr(info, ptr, false);
    bool ok = SetInformationJobObject(job, 9, ptr, (uint)length) && AssignProcessToJobObject(job, GetCurrentProcess());
    Marshal.FreeHGlobal(ptr);
    return ok;
  }
}
"@
$linked = [SunprintJob]::Join()

function Test-Url($url) {
  try { (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $false }
}

function Show-LogTail($path) {
  if (Test-Path $path) { Get-Content $path -Tail 15 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray } }
}

function Wait-Until($label, $url, $process, $log, $seconds) {
  Write-Host -NoNewline "  $label"
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Url $url) { Write-Host ' ready' -ForegroundColor Green; return $true }
    if ($process -and $process.HasExited) { break }
    Write-Host -NoNewline '.'
    Start-Sleep -Seconds 2
  }
  Write-Host ' failed' -ForegroundColor Red
  Write-Host "  It didn't start. Last lines of $log :" -ForegroundColor Yellow
  Show-LogTail $log
  return $false
}

Write-Host ''
Write-Host '  Sunprint' -ForegroundColor Yellow
Write-Host ''

# --- ComfyUI -------------------------------------------------------------------------------
$comfy = $null
$comfyLog = Join-Path $logDir 'comfyui.log'

# The studio's video joins need the Sunprint custom node; keep ComfyUI's copy up to date.
$sunprintNode = Join-Path $root 'custom_nodes\sunprint_join_videos.py'
$installedNode = Join-Path $comfyDir 'custom_nodes\sunprint_join_videos.py'
if ((Test-Path (Join-Path $comfyDir 'custom_nodes')) -and
    (-not (Test-Path $installedNode) -or (Get-FileHash $sunprintNode).Hash -ne (Get-FileHash $installedNode).Hash)) {
  Copy-Item $sunprintNode $installedNode -Force
}

if (Test-Url "$comfyUrl/system_stats") {
  Write-Host '  ComfyUI is already running; using it (it will keep running after you close this).' -ForegroundColor DarkYellow
} else {
  $comfy = Start-Process -FilePath (Join-Path $comfyDir 'venv\Scripts\python.exe') `
    -ArgumentList 'main.py', '--lowvram', '--use-pytorch-cross-attention', '--port', '8188' `
    -WorkingDirectory $comfyDir -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $comfyLog -RedirectStandardError (Join-Path $logDir 'comfyui.err.log')
  if (-not (Wait-Until 'Starting ComfyUI (about 20-40 s)' "$comfyUrl/system_stats" $comfy (Join-Path $logDir 'comfyui.err.log') 240)) {
    Read-Host '  Press Enter to close'
    exit 1
  }
}

# --- Studio --------------------------------------------------------------------------------
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  Write-Host '  Node.js is not installed, so the studio cannot start. Install it from nodejs.org.' -ForegroundColor Red
  Read-Host '  Press Enter to close'
  exit 1
}
$vite = Join-Path $studioDir 'node_modules\vite\bin\vite.js'
if (-not (Test-Path $vite)) {
  Write-Host '  Installing the studio (first run only)...'
  Push-Location $studioDir; & npm install --no-audit --no-fund | Out-Null; Pop-Location
}

# Rebuild only when the studio's code changed since the last build.
$dist = Join-Path $studioDir 'dist\index.html'
$newest = Get-ChildItem (Join-Path $studioDir 'src'), (Join-Path $studioDir 'index.html'), (Join-Path $studioDir 'vite.config.ts') -Recurse -File |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not (Test-Path $dist) -or $newest.LastWriteTime -gt (Get-Item $dist).LastWriteTime) {
  Write-Host -NoNewline '  Building the studio'
  Push-Location $studioDir
  & $node $vite build *> (Join-Path $logDir 'studio-build.log')
  $built = $LASTEXITCODE -eq 0
  Pop-Location
  if ($built) { Write-Host ' done' -ForegroundColor Green } else {
    Write-Host ' failed' -ForegroundColor Red
    Show-LogTail (Join-Path $logDir 'studio-build.log')
    Read-Host '  Press Enter to close'
    exit 1
  }
}

$studioLog = Join-Path $logDir 'studio.log'
$studio = Start-Process -FilePath $node -ArgumentList "`"$vite`"", 'preview', '--host', '127.0.0.1', '--port', '5173', '--strictPort' `
  -WorkingDirectory $studioDir -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $studioLog -RedirectStandardError (Join-Path $logDir 'studio.err.log')
if (-not (Wait-Until 'Starting the studio' "$studioUrl/api/system_stats" $studio (Join-Path $logDir 'studio.err.log') 60)) {
  Read-Host '  Press Enter to close'
  exit 1
}

if (-not $NoBrowser) { Start-Process $studioUrl }
Write-Host ''
Write-Host "  Sunprint is open at $studioUrl" -ForegroundColor Green
if ($linked) {
  Write-Host '  Keep this window open while you work. Close it, or press Q, to stop everything.'
} else {
  Write-Host '  Press Q here to stop everything (closing the window may leave ComfyUI running).' -ForegroundColor DarkYellow
}
Write-Host "  Logs: $logDir" -ForegroundColor DarkGray
Write-Host ''

# --- Keep watch until the person quits -----------------------------------------------------
$interactive = -not [Console]::IsInputRedirected
try {
  while ($true) {
    if ($comfy -and $comfy.HasExited) {
      Write-Host '  ComfyUI stopped unexpectedly. Last lines of its log:' -ForegroundColor Red
      Show-LogTail (Join-Path $logDir 'comfyui.err.log')
      Read-Host '  Press Enter to close'
      break
    }
    if ($studio.HasExited) {
      Write-Host '  The studio stopped unexpectedly.' -ForegroundColor Red
      Show-LogTail (Join-Path $logDir 'studio.err.log')
      Read-Host '  Press Enter to close'
      break
    }
    if ($interactive -and [Console]::KeyAvailable -and [Console]::ReadKey($true).Key -eq 'Q') { break }
    Start-Sleep -Milliseconds 500
  }
} finally {
  Write-Host '  Stopping Sunprint...'
  foreach ($p in @($studio, $comfy)) {
    if ($p -and -not $p.HasExited) { & taskkill /PID $p.Id /T /F 2>&1 | Out-Null }
  }
}
