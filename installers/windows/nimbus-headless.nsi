; NSIS 3.x — headless Nimbus CLI + Gateway (§7.9)
; Prerequisites: NSIS 3 (makensis on PATH).
;
; Build:
;   1. bun run package:headless   (produces dist/headless-bundle/*.exe on Windows)
;   2. copy dist/headless-bundle/nimbus-gateway.exe and nimbus.exe next to this .nsi
;   3. makensis nimbus-headless.nsi
;
; The installer places both binaries in Program Files\Nimbus. Add that folder to PATH manually
; or use System Properties → Environment Variables (documented in installers/README.md).

!define PRODUCT "Nimbus"
!define OUTFILE "nimbus-headless-setup.exe"

Name "${PRODUCT} (headless)"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\Nimbus"
RequestExecutionLevel admin

Section "Install"
  SetOutPath $InstDir
  File "nimbus-gateway.exe"
  File "nimbus.exe"
  WriteUninstaller "$InstDir\Uninstall.exe"
SectionEnd

Section "Uninstall"
  Delete "$InstDir\nimbus.exe"
  Delete "$InstDir\nimbus-gateway.exe"
  Delete "$InstDir\Uninstall.exe"
  RMDir "$InstDir"
SectionEnd
