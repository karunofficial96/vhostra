!macro customInstall
  ExecWait '"$INSTDIR\Vhostra.exe" --vhostra-cli-path-install "$INSTDIR"' $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Vhostra was installed, but its CLI could not be added to your user PATH. Reinstall to retry."
  ${EndIf}
  System::Call 'user32::SendMessageTimeout(p 0xffff, i 0x1A, p 0, t "Environment", i 2, i 5000, *p .r0) p .r1'
!macroend

!macro customUnInstall
  ExecWait '"$INSTDIR\Vhostra.exe" --vhostra-cli-path-uninstall "$INSTDIR"' $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONSTOP "Vhostra could not remove its user PATH entry. Uninstall was stopped so the CLI integration can be retried safely."
    Abort
  ${EndIf}
  System::Call 'user32::SendMessageTimeout(p 0xffff, i 0x1A, p 0, t "Environment", i 2, i 5000, *p .r0) p .r1'
!macroend
