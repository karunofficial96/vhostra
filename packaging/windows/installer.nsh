!macro customInstall
  ${IfNot} ${FileExists} "$INSTDIR\vhostra.cmd"
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "Vhostra's CLI launcher is missing from the installation."
    ${EndIf}
    SetErrorLevel 1
    Quit
  ${EndIf}
  ; electron-builder stores InstallLocation in its private install key. Publish
  ; the same directory in the uninstall entry used by Windows and CI.
  WriteRegStr SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "InstallLocation" "$INSTDIR"
  ExecWait '"$INSTDIR\Vhostra.exe" --vhostra-cli-path-install "$INSTDIR"' $0
  ${If} $0 != 0
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "Vhostra was installed, but its CLI could not be added to your user PATH. Reinstall to retry."
    ${EndIf}
    SetErrorLevel 1
    Quit
  ${EndIf}
  System::Call 'user32::SendMessageTimeout(p 0xffff, i 0x1A, p 0, t "Environment", i 2, i 5000, *p .r0) p .r1'
!macroend

!macro customUnInstall
  ExecWait '"$INSTDIR\Vhostra.exe" --vhostra-cli-path-uninstall "$INSTDIR"' $0
  ${If} $0 != 0
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "Vhostra could not remove its user PATH entry. Uninstall was stopped so the CLI integration can be retried safely."
    ${EndIf}
    SetErrorLevel 1
    Abort
  ${EndIf}
  System::Call 'user32::SendMessageTimeout(p 0xffff, i 0x1A, p 0, t "Environment", i 2, i 5000, *p .r0) p .r1'
!macroend
