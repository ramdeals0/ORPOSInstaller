<#
.SYNOPSIS
  ORPOS single-target deployment steps for WinRM worker (Windows host).

.DESCRIPTION
  Invoked by the Node/.NET worker against a remote session. This script is the
  production path when DEPLOY_MODE=winrm.

  ant.installer.properties ($AntPropertiesPath) is a LOCAL path on the target
  register host. It is verified and copied on that host into the extracted
  installer root — not read from a UNC share on the deploy server.
#>

param(
  [Parameter(Mandatory = $true)][string]$ComputerName,
  [Parameter(Mandatory = $true)][string]$InstallerZipPath,
  [Parameter(Mandatory = $true)][string]$AntPropertiesPath,
  [Parameter(Mandatory = $true)][string]$RemoteCopyPath,
  [Parameter(Mandatory = $true)][string]$RemoteUnzipPath,
  [Parameter(Mandatory = $false)][string]$CurrentInstallPath = 'C:\OracleRetailStore\CLIENT',
  [Parameter(Mandatory = $false)][string]$ReleaseNumber = '13.4.9',
  [Parameter(Mandatory = $false)][switch]$DryRun
)

$ErrorActionPreference = 'Stop'

if ($AntPropertiesPath -match '^\\\\') {
  throw "AntPropertiesPath must be a local path on the target host, not UNC: $AntPropertiesPath"
}

function Get-BackupName {
  return ("CLIENT_{0:yyyyMMdd_HHmmss}" -f (Get-Date))
}

function Test-OrposPrechecks {
  param($Session)

  # ZIP may be on a share visible to the worker (or target). Properties are LOCAL on target.
  $zipOk = Test-Path -LiteralPath $InstallerZipPath

  $remote = Invoke-Command -Session $Session -ScriptBlock {
    param($CopyPath, $UnzipPath, $InstallPath, $PropsPath)
    $null = New-Item -ItemType Directory -Force -Path $CopyPath, $UnzipPath
    $installExists = Test-Path -LiteralPath $InstallPath
    $propsExists = Test-Path -LiteralPath $PropsPath
    $drive = (Get-Item $InstallPath -ErrorAction SilentlyContinue)?.PSDrive?.Name
    if (-not $drive) { $drive = 'C' }
    $free = (Get-PSDrive $drive).Free
    [pscustomobject]@{
      InstallExists  = $installExists
      PropertiesOk   = $propsExists
      FreeBytes      = $free
      CopyPath       = $CopyPath
      UnzipPath      = $UnzipPath
      PropertiesPath = $PropsPath
    }
  } -ArgumentList $RemoteCopyPath, $RemoteUnzipPath, $CurrentInstallPath, $AntPropertiesPath

  [pscustomobject]@{
    ZipOk           = $zipOk
    PropertiesOk    = $remote.PropertiesOk
    InstallExists   = $remote.InstallExists
    FreeBytes       = $remote.FreeBytes
    RemoteCopyPath  = $remote.CopyPath
    RemoteUnzipPath = $remote.UnzipPath
    PropertiesPath  = $remote.PropertiesPath
  }
}

$session = New-PSSession -ComputerName $ComputerName
try {
  $pre = Test-OrposPrechecks -Session $session
  if (-not $pre.ZipOk) { throw "Installer ZIP missing: $InstallerZipPath" }
  if (-not $pre.PropertiesOk) { throw "ant.installer.properties missing on target host: $AntPropertiesPath" }
  if (-not $pre.InstallExists) { throw "Current install path missing: $CurrentInstallPath" }

  if ($DryRun) {
    Write-Output (@{ Status = 'DRY_RUN_PASSED'; Precheck = $pre } | ConvertTo-Json -Depth 5)
    return
  }

  $backupLeaf = Get-BackupName
  $parent = Split-Path -Parent $CurrentInstallPath
  $backupPath = Join-Path $parent $backupLeaf

  Invoke-Command -Session $session -ScriptBlock {
    param($InstallPath, $BackupPath)
    Rename-Item -LiteralPath $InstallPath -NewName (Split-Path -Leaf $BackupPath)
  } -ArgumentList $CurrentInstallPath, $backupPath

  $remoteZip = Join-Path $RemoteCopyPath ("ORPOS-{0}.zip" -f $ReleaseNumber)
  Copy-Item -LiteralPath $InstallerZipPath -Destination $remoteZip -ToSession $session -Force

  Invoke-Command -Session $session -ScriptBlock {
    param($Zip, $Dest)
    if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
    Expand-Archive -LiteralPath $Zip -DestinationPath $Dest -Force
  } -ArgumentList $remoteZip, $RemoteUnzipPath

  # Copy properties from target-local path into extracted installer root (same machine)
  Invoke-Command -Session $session -ScriptBlock {
    param($ExtractRoot, $PropsPath)
    if (-not (Test-Path -LiteralPath $PropsPath)) {
      throw "ant.installer.properties not found on target: $PropsPath"
    }
    $cmd = Get-ChildItem -Path $ExtractRoot -Filter 'install.cmd' -Recurse | Select-Object -First 1
    if (-not $cmd) { throw 'install.cmd not found after extract' }
    Copy-Item -LiteralPath $PropsPath -Destination (Join-Path $cmd.DirectoryName 'ant.installer.properties') -Force
    $proc = Start-Process -FilePath $cmd.FullName -ArgumentList 'silent' -Wait -PassThru -WorkingDirectory $cmd.DirectoryName
    $log = Get-ChildItem -Path $ExtractRoot -Filter 'pos-install-*log' -Recurse | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    [pscustomobject]@{
      ExitCode = $proc.ExitCode
      LogPath  = $log?.FullName
      LogTail  = if ($log) { Get-Content -LiteralPath $log.FullName -Tail 80 | Out-String } else { '' }
      PropsSource = $PropsPath
      PropsDest   = (Join-Path $cmd.DirectoryName 'ant.installer.properties')
    }
  } -ArgumentList $RemoteUnzipPath, $AntPropertiesPath
}
finally {
  if ($session) { Remove-PSSession $session }
}
