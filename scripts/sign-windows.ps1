# scripts/sign-windows.ps1
param(
  [Parameter(Mandatory=$true)][string]$Target
)

$ErrorActionPreference = "Stop"

if (-not $Env:WINDOWS_CERTIFICATE -or -not $Env:WINDOWS_CERTIFICATE_PWD) {
  Write-Host "signing skipped: WINDOWS_CERTIFICATE not set"
  exit 0
}

$CertPath = [System.IO.Path]::GetTempFileName()
[System.IO.File]::WriteAllBytes($CertPath, [Convert]::FromBase64String($Env:WINDOWS_CERTIFICATE))

& signtool sign /fd SHA256 /td SHA256 `
  /tr "http://timestamp.digicert.com" `
  /f $CertPath /p $Env:WINDOWS_CERTIFICATE_PWD `
  $Target

Remove-Item $CertPath
Write-Host "signed: $Target"
