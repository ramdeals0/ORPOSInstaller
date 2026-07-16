<#
.SYNOPSIS
  ORPOS single-target deployment steps for WinRM worker (Windows host).

.DESCRIPTION
  Invoked by the Node/.NET worker against a remote session. This script is the
  production path when DEPLOY_MODE=winrm. The Node worker currently uses a
  simulator on non-Windows; call these functions from a Windows worker host.
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

function Get-BackupName {
  return ("CLIENT_{0:yyyyMMdd_HHmmss}" -f (Get-Date))
}

function Test-OrposPrechecks {
  param($Session)

  $zipOk = Test-Path -LiteralPath $InstallerZipPath
  $propsOk = Test-Path -LiteralPath $AntPropertiesPath

  $remote = Invoke-Command -Session $Session -ScriptBlock {
    param($CopyPath, $UnzipPath, $InstallPath)
    $null = New-Item -ItemType Directory -Force -Path $CopyPath, $UnzipPath
    $installExists = Test-Path -LiteralPath $InstallPath
    $drive = (Get-Item $InstallPath -ErrorAction SilentlyContinue)?.PSDrive?.Name
    if (-not $drive) { $drive = 'C' }
    $free = (Get-PSDrive $drive).Free
    [pscustomobject]@{
      InstallExists = $installExists
      FreeBytes     = $free
      CopyPath      = $CopyPath
      UnzipPath     = $UnzipPath
    }
  } -ArgumentList $RemoteCopyPath, $RemoteUnzipPath, $CurrentInstallPath

  [pscustomobject]@{
    ZipOk          = $zipOk
    PropertiesOk   = $propsOk
    InstallExists  = $remote.InstallExists
    FreeBytes      = $remote.FreeBytes
    RemoteCopyPath = $remote.CopyPath
    RemoteUnzipPath= $remote.UnzipPath
  }
}

$session = New-PSSession -ComputerName $ComputerName
try {
  $pre = Test-OrposPrechecks -Session $session
  if (-not $pre.ZipOk) { throw "Installer ZIP missing: $InstallerZipPath" }
  if (-not $pre.PropertiesOk) { throw "Properties missing: $AntPropertiesPath" }
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

  Invoke-Command -Session $session -ScriptBlock {
    param($ExtractRoot, $PropsPath)
    $cmd = Get-ChildItem -Path $ExtractRoot -Filter 'install.cmd' -Recurse | Select-Object -First 1
    if (-not $cmd) { throw 'install.cmd not found after extract' }
    Copy-Item -LiteralPath $PropsPath -Destination $cmd.DirectoryName -Force
    $proc = Start-Process -FilePath $cmd.FullName -ArgumentList 'silent' -Wait -PassThru -WorkingDirectory $cmd.DirectoryName
    $log = Get-ChildItem -Path $ExtractRoot -Filter 'pos-install-*log' -Recurse | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    [pscustomobject]@{
      ExitCode = $proc.ExitCode
      LogPath  = $log?.FullName
      LogTail  = if ($log) { Get-Content -LiteralPath $log.FullName -Tail 80 | Out-String } else { '' }
    }
  } -ArgumentList $RemoteUnzipPath, $AntPropertiesPath
}
finally {
  if ($session) { Remove-PSSession $session }
}
