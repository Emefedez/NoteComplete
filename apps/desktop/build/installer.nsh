; Windows "Open with" for common files NoteComplete can show (open-with.js OTHER_TYPES).
; electron-builder's fileAssociations would make it their default handler, so they are
; listed here instead: only under OpenWithProgids and the app's SupportedTypes, which add
; NoteComplete to "Open with" and leave the user's default alone.
!define NOTECOMPLETE_PROGID "NoteComplete.File"

!macro noteCompleteOpenWith EXT
  WriteRegStr SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${NOTECOMPLETE_PROGID}" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" ".${EXT}" ""
!macroend

!macro noteCompleteForget EXT
  DeleteRegValue SHELL_CONTEXT "Software\Classes\.${EXT}\OpenWithProgids" "${NOTECOMPLETE_PROGID}"
!macroend

!macro customInstall
  WriteRegStr SHELL_CONTEXT "Software\Classes\${NOTECOMPLETE_PROGID}" "" "Document"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${NOTECOMPLETE_PROGID}\DefaultIcon" "" "$appExe,0"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${NOTECOMPLETE_PROGID}\shell\open" "" "Open with NoteComplete"
  WriteRegStr SHELL_CONTEXT "Software\Classes\${NOTECOMPLETE_PROGID}\shell\open\command" "" '"$appExe" "%1"'
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "NoteComplete"
  WriteRegStr SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$appExe" "%1"'
  !insertmacro noteCompleteOpenWith "pdf"
  !insertmacro noteCompleteOpenWith "png"
  !insertmacro noteCompleteOpenWith "jpg"
  !insertmacro noteCompleteOpenWith "jpeg"
  !insertmacro noteCompleteOpenWith "webp"
  !insertmacro noteCompleteOpenWith "tar"
  !insertmacro noteCompleteOpenWith "md"
  !insertmacro noteCompleteOpenWith "markdown"
  !insertmacro noteCompleteOpenWith "txt"
  !insertmacro noteCompleteOpenWith "html"
  !insertmacro noteCompleteOpenWith "htm"
  !insertmacro noteCompleteOpenWith "docx"
  !insertmacro noteCompleteOpenWith "odt"
  !insertmacro noteCompleteOpenWith "xlsx"
  !insertmacro noteCompleteOpenWith "ods"
  !insertmacro noteCompleteOpenWith "csv"
  !insertmacro noteCompleteOpenWith "tsv"
  System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'
!macroend

!macro customUnInstall
  !insertmacro noteCompleteForget "pdf"
  !insertmacro noteCompleteForget "png"
  !insertmacro noteCompleteForget "jpg"
  !insertmacro noteCompleteForget "jpeg"
  !insertmacro noteCompleteForget "webp"
  !insertmacro noteCompleteForget "tar"
  !insertmacro noteCompleteForget "md"
  !insertmacro noteCompleteForget "markdown"
  !insertmacro noteCompleteForget "txt"
  !insertmacro noteCompleteForget "html"
  !insertmacro noteCompleteForget "htm"
  !insertmacro noteCompleteForget "docx"
  !insertmacro noteCompleteForget "odt"
  !insertmacro noteCompleteForget "xlsx"
  !insertmacro noteCompleteForget "ods"
  !insertmacro noteCompleteForget "csv"
  !insertmacro noteCompleteForget "tsv"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\${NOTECOMPLETE_PROGID}"
  DeleteRegKey SHELL_CONTEXT "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
!macroend
