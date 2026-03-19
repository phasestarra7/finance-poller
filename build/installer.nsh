!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.phasestarr.financepoller"
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "com.phasestarr.financepoller"
  RMDir /r "$APPDATA\FinancePoller"
!macroend
