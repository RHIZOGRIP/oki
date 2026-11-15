; One file to download and open: unpacks a release image/release.sh built and runs its
; "Install Oki.cmd". Built by makensis, with RELEASE, DIR (the release directory) and OUT defined.
Unicode true
Name "Oki ${RELEASE}"
Icon "${DIR}/files/oki.ico"
VIProductVersion "${RELEASE}.0"
VIAddVersionKey "ProductName" "Oki"
VIAddVersionKey "FileDescription" "Oki installer"
VIAddVersionKey "FileVersion" "${RELEASE}"
VIAddVersionKey "ProductVersion" "${RELEASE}"
VIAddVersionKey "CompanyName" "Rhizogrip"
OutFile "${OUT}"
RequestExecutionLevel user
SilentInstall silent
SetCompressor /SOLID lzma

Section
  InitPluginsDir
  SetOutPath "$PLUGINSDIR"
  File "${DIR}/Install Oki.cmd"
  SetOutPath "$PLUGINSDIR\files"
  File "${DIR}/files/*"
  ; This program is 32-bit, and wsl.exe is only in the 64-bit System32, which Sysnative names.
  ExecWait '"$WINDIR\Sysnative\cmd.exe" /c ""$PLUGINSDIR\Install Oki.cmd""'
  SetOutPath "$TEMP"
SectionEnd
