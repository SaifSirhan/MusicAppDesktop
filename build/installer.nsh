; electron-builder NSIS hooks for MusicApp.
; customInit runs at installer init, after $INSTDIR is resolved and before the
; new files are written. Removing any existing MusicApp install here guarantees a
; clean reinstall with no stale files from a previous version. User data in
; %APPDATA%\MusicApp (login, settings) is deliberately left untouched.
!macro customInit
  ${if} ${FileExists} "$INSTDIR\MusicApp.exe"
    DetailPrint "Removing previous MusicApp install for a clean reinstall..."
    RMDir /r "$INSTDIR"
  ${endif}
!macroend
