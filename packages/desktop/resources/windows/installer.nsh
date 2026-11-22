; The manifest digest comes from the final packaged files, after signing, at NSIS compile time.
; A previous install is trusted only through the receipt in this channel's own registration.
!ifndef PANACODE_BUILD_SHA256
  !ifdef APP_ARM64
    !define /file PANACODE_BUILD_SHA256 "${NSIS_OUTPUT_DIR}\${APP_ID}-arm64.manifest.sha256"
  !else
    !define /file PANACODE_BUILD_SHA256 "${NSIS_OUTPUT_DIR}\${APP_ID}-x64.manifest.sha256"
  !endif
!endif
!define PANACODE_MANUAL_INSTALL
!define PANACODE_LEGACY_DIRECTORY "@opencodedesktop"

Var panacodePath
Var panacodeExpanded
Var panacodeSavedOut
Var panacodePin
Var panacodeOldPin
Var panacodeUninstallerPin
Var panacodeIconPin
Var panacodeImageOwned
Var panacodeSharedImageOwned
!ifndef BUILD_UNINSTALLER
  Var panacodeShared
  Var panacodeSharedOwned
  Var panacodeVerified
  Var panacodeBackup
  Var panacodeNewUninstallerPin
  Var panacodeNewIconPin
  Var panacodeStage
!endif

; Normalize lexical components even on a fresh path. For an existing path, expand 8.3 names too:
; registry values, TEMP, and QueryFullProcessImageNameW can use different spellings of one path.
!macro panacodeCanonicalize INPUT OUTPUT
  ${StdUtils.NormalizePath} $panacodeExpanded "${INPUT}"
  Push $0
  Push $1
  System::Call 'kernel32::GetLongPathNameW(w "$panacodeExpanded", w .r0, i ${NSIS_MAX_STRLEN}) i .r1'
  ${If} $1 > 0
  ${AndIf} $1 < ${NSIS_MAX_STRLEN}
    StrCpy $panacodeExpanded $0
  ${EndIf}
  Pop $1
  Pop $0
  StrCpy ${OUTPUT} $panacodeExpanded
!macroend

; Sets RESULT to 1 when DIR does not exist or holds no entries. FindFirst reports "." and "..", so a
; plain "first entry is non-empty" check would treat every existing directory as occupied.
; RESULT must be outside $0-$1. Clobbers $0-$1.
!macro panacodeDirIsEmpty DIR RESULT
  StrCpy ${RESULT} 1
  FindFirst $0 $1 "${DIR}\*.*"
  ${DoWhile} $1 != ""
    ${If} $1 != "."
    ${AndIf} $1 != ".."
      StrCpy ${RESULT} 0
      ${ExitDo}
    ${EndIf}
    FindNext $0 $1
  ${Loop}
  FindClose $0
!macroend

; Sets RESULT to 0 when the path or any existing ancestor is a reparse point. RESULT must be a
; register outside $R0-$R2.
!macro panacodePathIsContained DIR RESULT
  StrCpy ${RESULT} 1
  StrCpy $R0 "${DIR}"
  ${Do}
    System::Call 'kernel32::GetFileAttributesW(w "$R0") i .R1 ?e'
    Pop $R2
    ${If} $R1 == -1
      ; Only a missing path/parent is permissible for a fresh installation.
      ${If} $R2 != 2
      ${AndIf} $R2 != 3
        StrCpy ${RESULT} 0
        ${ExitDo}
      ${EndIf}
    ${Else}
      IntOp $R1 $R1 & 0x400
      ${If} $R1 != 0
        StrCpy ${RESULT} 0
        ${ExitDo}
      ${EndIf}
    ${EndIf}
    StrLen $R1 $R0
    ${If} $R1 <= 3
      StrCpy $R2 $R0 1 1
      ${If} $R2 == ":"
        ${ExitDo}
      ${EndIf}
    ${EndIf}
    ${StdUtils.GetParentPath} $R2 "$R0"
    ${If} $R2 == ""
      ${ExitDo}
    ${EndIf}
    ${If} $R2 == $R0
      ${ExitDo}
    ${EndIf}
    StrCpy $R0 $R2
  ${Loop}
!macroend


; The helper is extracted from this installer, never loaded from the destination or PATH.
; DIR and PIN may be registers. Preserve them before any plugin or path helper runs.
!macro panacodeFiles ACTION DIR PIN RESULT
  StrCpy $panacodePath "${DIR}"
  StrCpy $panacodePin "${PIN}"
  StrCpy $panacodeSavedOut $OUTDIR
  InitPluginsDir
  ClearErrors
  File "/oname=$PLUGINSDIR\panacode-files.ps1" "${BUILD_RESOURCES_DIR}\windows\install-files.ps1"
  ${If} ${Errors}
  ${OrIfNot} ${FileExists} "$PLUGINSDIR\panacode-files.ps1"
    StrCpy ${RESULT} 30
  ${ElseIfNot} ${FileExists} "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
    StrCpy ${RESULT} 31
  ${Else}
    ; $PLUGINSDIR contains NSIS' native System.dll. Windows PowerShell's compiler resolves
    ; framework assemblies relative to its working directory. It must never start there.
    SetOutPath "$SYSDIR\WindowsPowerShell\v1.0"
    ClearErrors
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\panacode-files.ps1" -Action "${ACTION}" -Root "$panacodePath" -Pin "$panacodePin" -AppId "${APP_ID}" -Executable "${APP_EXECUTABLE_FILENAME}"' ${RESULT}
    ${If} ${Errors}
      StrCpy ${RESULT} 32
    ${EndIf}
    SetOutPath "$panacodeSavedOut"
  ${EndIf}
!macroend

!macro panacodeMatches DIR PIN RESULT
  StrCpy $panacodePath "${DIR}"
  StrCpy $panacodePin "${PIN}"
  StrCpy ${RESULT} 0
  StrLen $R3 $panacodePin
  ${If} $R3 == 64
    !insertmacro panacodePathIsContained "$panacodePath\.panacode-install" $R3
    ${If} $R3 == 1
    ${AndIf} ${FileExists} "$panacodePath\.panacode-install"
      ${StdUtils.HashFile} $R3 "SHA2-256" "$panacodePath\.panacode-install"
      ${If} $R3 == $panacodePin
        StrCpy ${RESULT} 1
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro panacodeRemoveAux DIR NAME PIN
  StrLen $R3 "${PIN}"
  ${If} $R3 == 64
    !insertmacro panacodePathIsContained "${DIR}\${NAME}" $R3
    ${If} $R3 == 1
    ${AndIf} ${FileExists} "${DIR}\${NAME}"
      ${StdUtils.HashFile} $R3 "SHA2-256" "${DIR}\${NAME}"
      ${If} $R3 == "${PIN}"
        Delete "${DIR}\${NAME}"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

; Only called for a registered installation or a directory moved by this installer.
!macro panacodeRetire DIR RESULT
  StrCpy ${RESULT} 0
  !insertmacro panacodeMatches "${DIR}" "$panacodeOldPin" $R4
  ${If} $R4 == 1
    !insertmacro panacodeFiles Remove "${DIR}" "$panacodeOldPin" $R4
    ${If} $R4 == 0
      !insertmacro panacodeRemoveAux "${DIR}" "${UNINSTALL_FILENAME}" "$panacodeUninstallerPin"
      !insertmacro panacodeRemoveAux "${DIR}" "uninstallerIcon.ico" "$panacodeIconPin"
      RMDir "${DIR}"
      StrCpy ${RESULT} 1
    ${EndIf}
  ${EndIf}
!macroend

!macro panacodeFail CODE REASON
  ${IfNot} ${Silent}
    MessageBox MB_OK|MB_ICONSTOP "${REASON}"
  ${EndIf}
  SetErrorLevel ${CODE}
  Quit
!macroend


; Refuses the protected directory itself and any of its ancestors. Descendants stay allowed, so the
; default per-user install under LocalAppData\Programs keeps working.
!macro panacodeRefuseProtected PATH
  !insertmacro panacodeCanonicalize "${PATH}" $R2
  ${If} $INSTDIR == $R2
    !insertmacro panacodeFail 50 "Panacode cannot install directly into a protected system or profile folder. Choose a private folder."
  ${EndIf}
  StrLen $R0 $INSTDIR
  IntOp $R0 $R0 + 1
  StrCpy $R1 $R2 $R0
  ${If} $R1 == "$INSTDIR\"
    !insertmacro panacodeFail 51 "Panacode cannot install into a folder that contains a protected system or profile folder. Choose a private folder."
  ${EndIf}
!macroend

!macro panacodeValidateTarget
  !insertmacro panacodeCanonicalize "$INSTDIR" $INSTDIR

  ${If} $INSTDIR == ""
    !insertmacro panacodeFail 52 "Panacode cannot use an empty installation folder. Choose a private folder."
  ${EndIf}

  StrCpy $R0 $INSTDIR 2
  ${If} $R0 == "\\"
    !insertmacro panacodeFail 53 "Panacode cannot install to a network share. Choose a local private folder."
  ${EndIf}

  StrLen $R0 $INSTDIR
  ${If} $R0 <= 3
    StrCpy $R1 $INSTDIR 1 1
    ${If} $R1 == ":"
      !insertmacro panacodeFail 54 "Panacode cannot install into a drive root. Choose a private folder."
    ${EndIf}
  ${EndIf}

  !insertmacro panacodeRefuseProtected "$PROFILE"
  !insertmacro panacodeRefuseProtected "$LOCALAPPDATA"
  !insertmacro panacodeRefuseProtected "$APPDATA"
  !insertmacro panacodeRefuseProtected "$PROGRAMFILES"
  !insertmacro panacodeRefuseProtected "$PROGRAMFILES64"
  !insertmacro panacodeRefuseProtected "$WINDIR"
  !insertmacro panacodeRefuseProtected "$SYSDIR"
  !insertmacro panacodeRefuseProtected "$TEMP"
  !insertmacro panacodeRefuseProtected "$DESKTOP"
  !insertmacro panacodeRefuseProtected "$DOCUMENTS"
  !insertmacro panacodeRefuseProtected "$QUICKLAUNCH"
  !insertmacro panacodeRefuseProtected "$STARTMENU"
  !insertmacro panacodeRefuseProtected "$SMPROGRAMS"
  !insertmacro panacodeRefuseProtected "$FONTS"
  !insertmacro panacodeRefuseProtected "$COMMONFILES"

  !insertmacro panacodePathIsContained "$INSTDIR" $R3
  ${If} $R3 == 0
    !insertmacro panacodeFail 55 "Panacode cannot install through a junction or symbolic link. Choose a real local folder."
  ${EndIf}

!macroend

!macro panacodeReadReceipt
  ReadRegStr $R3 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" PanacodeInstallReceipt
  StrCpy $panacodeOldPin $R3 64
  StrCpy $panacodeUninstallerPin $R3 64 65
  StrCpy $panacodeIconPin $R3 64 130
!macroend

!macro customInit
  StrCpy $panacodeShared ""
  StrCpy $panacodeSharedOwned 0
  StrCpy $panacodeVerified 0
  StrCpy $panacodeBackup ""
  !insertmacro panacodeReadReceipt
  !insertmacro panacodeValidateTarget

  ReadRegStr $R1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  !insertmacro panacodeCanonicalize "$R1" $R8
  ${StdUtils.GetParentPath} $R2 "$INSTDIR"
  ${If} $INSTDIR == "$R2\${PANACODE_LEGACY_DIRECTORY}"
    ${If} $R8 == "$INSTDIR"
      StrCpy $panacodeShared "$INSTDIR"
    ${EndIf}
    StrCpy $INSTDIR "$R2\${APP_ID}"
    !insertmacro panacodeValidateTarget
  ${EndIf}
  ${If} $panacodeShared != ""
    !insertmacro panacodeMatches "$panacodeShared" "$panacodeOldPin" $panacodeSharedOwned
  ${EndIf}
  ${If} $R8 != ""
  ${AndIf} $R8 != "$INSTDIR"
  ${AndIf} $R8 != "$panacodeShared"
    System::Call 'kernel32::GetFileAttributesW(w "$R8") i .R9'
    ${If} $R9 != -1
      !insertmacro panacodeFail 56 "Panacode is already installed in another folder."
    ${EndIf}
  ${EndIf}

  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR") i .R9'
  ${If} $R9 != -1
    IntOp $R7 $R9 & 0x10
    ${If} $R7 == 0
      !insertmacro panacodeFail 57 "The installation path must be a directory."
    ${EndIf}
    !insertmacro panacodeDirIsEmpty "$INSTDIR" $R6
    ${If} $R6 == 0
      ${If} $R8 != "$INSTDIR"
      ${OrIfNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
        !insertmacro panacodeFail 58 "Choose an empty directory or this Panacode installation."
      ${EndIf}
      !insertmacro panacodeMatches "$INSTDIR" "$panacodeOldPin" $panacodeVerified
    ${EndIf}
  ${EndIf}
!macroend

!macro customInstall
  ; Publish the three digests in one registry value. Keep the previous files if either
  ; the stock installer registration or the ownership receipt could not be committed.
  StrCpy $R5 "${PANACODE_BUILD_SHA256}/$panacodeNewUninstallerPin/$panacodeNewIconPin"
  ClearErrors
  WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" PanacodeInstallReceipt "$R5"
  ReadRegStr $R4 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" PanacodeInstallReceipt
  ReadRegStr $R3 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  ReadRegStr $R2 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
  StrCpy $R1 '"$INSTDIR\${UNINSTALL_FILENAME}"'
  StrLen $R0 $R1
  StrCpy $R2 $R2 $R0
  ${If} ${Errors}
  ${OrIf} $R5 != $R4
  ${OrIf} $R3 != "$INSTDIR"
  ${OrIf} $R2 != $R1
    !insertmacro panacodeFail 70 "Windows could not finish registering Panacode. The previous files have been retained. Run the installer again after restoring registry access."
  ${EndIf}
  ${If} $panacodeBackup != ""
    !insertmacro panacodeRetire "$panacodeBackup" $R6
  ${EndIf}
  ${If} $panacodeShared != ""
    !insertmacro panacodeRetire "$panacodeShared" $R6
    ${If} ${FileExists} "$QUICKLAUNCH\User Pinned\TaskBar\${SHORTCUT_NAME}.lnk"
      CreateShortCut "$QUICKLAUNCH\User Pinned\TaskBar\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
      WinShell::SetLnkAUMI "$QUICKLAUNCH\User Pinned\TaskBar\${SHORTCUT_NAME}.lnk" "${APP_ID}"
    ${EndIf}
  ${EndIf}
!macroend

!macro customDeleteAppData
  !insertmacro panacodeFiles DeleteAppData "$APPDATA\${APP_ID}" "${PANACODE_BUILD_SHA256}" $R4
  ${If} $R4 != 0
    DetailPrint "Panacode kept desktop data it could not verify."
  ${EndIf}
!macroend

!macro customRemoveFiles
  !insertmacro panacodeValidateTarget
  ReadRegStr $R2 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  !insertmacro panacodeCanonicalize "$R2" $R8
  !insertmacro panacodeReadReceipt
  !insertmacro panacodeMatches "$INSTDIR" "${PANACODE_BUILD_SHA256}" $R4
  ${If} $R8 != "$INSTDIR"
  ${OrIf} $panacodeOldPin != "${PANACODE_BUILD_SHA256}"
  ${OrIf} $R4 != 1
    !insertmacro panacodeFail 59 "Panacode could not verify the installed build."
  ${EndIf}
  SetOutPath $TEMP
  !insertmacro panacodeRetire "$INSTDIR" $R6
  ${If} $R6 != 1
    ; The stock uninstaller removes registrations after this macro returns. Keep the
    ; receipt so an interrupted removal or temporarily locked file can be retried.
    !insertmacro panacodeFail 83 "Windows could not finish verifying and removing Panacode. Its registration is intact. Close running files and retry."
  ${EndIf}
  ; Old copies and cached stages are siblings, outside the registered install root. A later
  ; uninstaller has no receipt binding those locations to a move it actually performed.
!macroend
!macro customCheckAppRunning
  !insertmacro panacodeCanonicalize "$INSTDIR" $INSTDIR

  StrCpy $panacodeImageOwned 0
  StrCpy $panacodeSharedImageOwned 0
  !insertmacro panacodeReadReceipt
  ReadRegStr $R8 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  !insertmacro panacodeCanonicalize "$R8" $R8
  !ifdef BUILD_UNINSTALLER
    ; An older copied uninstaller must not stop a newer registered application.
    !insertmacro panacodeMatches "$INSTDIR" "${PANACODE_BUILD_SHA256}" $R4
    ${If} $R4 != 1
    ${OrIf} $R8 != "$INSTDIR"
    ${OrIf} $panacodeOldPin != "${PANACODE_BUILD_SHA256}"
      !insertmacro panacodeFail 60 "This uninstaller does not belong to the registered build."
    ${EndIf}
  !endif
  ${If} $R8 == "$INSTDIR"
    !insertmacro panacodeMatches "$INSTDIR" "$panacodeOldPin" $R4
    ${If} $R4 == 1
      !insertmacro panacodeFiles Image "$INSTDIR" "$panacodeOldPin" $R4
      ${If} $R4 == 0
        StrCpy $panacodeImageOwned 1
      ${EndIf}
    ${EndIf}
  ${EndIf}
  !ifndef BUILD_UNINSTALLER
    ${If} $panacodeSharedOwned == 1
    ${AndIf} $R8 == "$panacodeShared"
      !insertmacro panacodeFiles Image "$panacodeShared" "$panacodeOldPin" $R4
      ${If} $R4 == 0
        StrCpy $panacodeSharedImageOwned 1
      ${EndIf}
    ${EndIf}
  !endif

  System::Call "kernel32::GetCurrentProcessId() i .R9"
  ; $R8 is the tick count after which processes still running are terminated.
  System::Call "kernel32::GetTickCount() i .R8"
  IntOp $R8 $R8 + 10000
  StrCpy $0 ""

  ${Do}
    System::Call "kernel32::GetTickCount() i .r1"
    IntOp $1 $1 - $R8
    StrCpy $R7 0
    System::Call "kernel32::CreateToolhelp32Snapshot(i 2, i 0) p .R0"
    ${If} $R0 <> -1
      ; PROCESSENTRY32W for the 32-bit installer: nine 4-byte fields, then WCHAR szExeFile[260].
      System::Alloc 556
      Pop $R1
      System::Call "*$R1(i 556)"
      System::Call "kernel32::Process32FirstW(p R0, p R1) i .R2"
      ${DoWhile} $R2 != 0
        System::Call "*$R1(i, i, i .R3)"
        ${If} $R3 != $R9
          ; One handle has both query and terminate rights, and the image is verified through it.
          System::Call "kernel32::OpenProcess(i 0x1001, i 0, i R3) p .R4"
          ${If} $R4 != 0
            System::Call "kernel32::QueryFullProcessImageNameW(p R4, i 0, w .R5, *i ${NSIS_MAX_STRLEN}) i .R6"
            ${If} $R6 != 0
              StrCpy $2 $R5 2
              ${If} $2 != "\\"
                !insertmacro panacodeCanonicalize "$R5" $R5
              ${EndIf}
              StrCpy $2 0
              ${If} $R5 == "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
                ${If} $panacodeImageOwned != 1
                  !insertmacro panacodeFail 61 "Close the application in the installation folder and try again. Panacode could not verify its running image."
                ${EndIf}
                StrCpy $2 1
              ${EndIf}
              !ifndef BUILD_UNINSTALLER
                ${If} $panacodeSharedImageOwned == 1
                ${AndIf} $R5 == "$panacodeShared\${APP_EXECUTABLE_FILENAME}"
                  StrCpy $2 1
                ${EndIf}
              !endif
              ${If} $2 == 1
                ${If} $1 >= 0
                  System::Call "kernel32::TerminateProcess(p R4, i 1)"
                  ; Count only a process that survived the termination attempt. $R1 holds the
                  ; snapshot entry and must stay live for the next Process32NextW.
                  System::Call "kernel32::GetExitCodeProcess(p R4, *i .R3) i .R2"
                  ${If} $R2 == 0
                  ${OrIf} $R3 == 259
                    IntOp $R7 $R7 + 1
                  ${EndIf}
                ${Else}
                  IntOp $R7 $R7 + 1
                ${EndIf}
              ${EndIf}
            ${EndIf}
            System::Call "kernel32::CloseHandle(p R4)"
          ${EndIf}
        ${EndIf}
        System::Call "kernel32::Process32NextW(p R0, p R1) i .R2"
      ${Loop}
      System::Free $R1
      System::Call "kernel32::CloseHandle(p R0)"
    ${EndIf}

    ${If} $R7 == 0
      ${ExitDo}
    ${EndIf}

    ${If} $0 == ""
      StrCpy $0 "running"
      ${IfNot} ${isUpdated}
        ${If} ${Cmd} `MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDCANCEL`
          Quit
        ${EndIf}
        ; The user confirmed: stop the app on the next pass instead of waiting for the update timeout.
        System::Call "kernel32::GetTickCount() i .R8"
      ${EndIf}
      DetailPrint "$(appClosing)"
    ${ElseIf} $1 >= 2000
      ${If} ${Cmd} `MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDCANCEL`
        Quit
      ${EndIf}
      System::Call "kernel32::GetTickCount() i .R8"
    ${EndIf}

    Sleep 100
  ${Loop}
!macroend

!ifndef BUILD_UNINSTALLER
!ifdef APP_64 | APP_ARM64
  !ifdef APP_64 & APP_ARM64
    !error "Expected one architecture per Panacode installer"
  !endif
  !ifdef APP_ARM64
    !define STAGED_PACKAGE "${APP_ARM64}"
    !define STAGED_PACKAGE_HASH "${APP_ARM64_HASH}"
  !else
    !define STAGED_PACKAGE "${APP_64}"
    !define STAGED_PACKAGE_HASH "${APP_64_HASH}"
  !endif

  ; Returns an exact build, either an existing complete stage or a new private extraction.
  ; A stage with changed bytes or extra files stays untouched.
  !macro panacodePrepareStage PUBLISH
    InitPluginsDir
    SetOutPath $PLUGINSDIR
    !insertmacro panacodeValidateTarget
    StrCpy $R6 "${STAGED_PACKAGE_HASH}" 16
    StrCpy $panacodeStage "$INSTDIR.update-$R6"
    !insertmacro panacodeMatches "$panacodeStage" "${PANACODE_BUILD_SHA256}" $R4
    ${If} $R4 == 1
      !insertmacro panacodeFiles Stage "$panacodeStage" "${PANACODE_BUILD_SHA256}" $R4
      ${If} $R4 == 0
        Goto panacodeStageReady_${PUBLISH}
      ${EndIf}
    ${EndIf}
    !if "${PUBLISH}" == "publish"
      System::Call 'kernel32::GetFileAttributesW(w "$panacodeStage") i .R4'
      ${If} $R4 != -1
        SetErrorLevel 2
        Quit
      ${EndIf}
    !endif
    System::Call "kernel32::GetCurrentProcessId() i .R4"
    StrCpy $panacodeStage "$INSTDIR.staging-$R4"
    !insertmacro panacodePathIsContained "$panacodeStage" $R4
    ${If} $R4 != 1
      !insertmacro panacodeFail 71 "The staging directory is not a local private directory."
    ${EndIf}
    ; CreateDirectoryW fails on an already existing directory; CreateDirectory (NSIS) succeeds.
    System::Call 'kernel32::CreateDirectoryW(w "$panacodeStage", p 0) i .R4'
    ${If} $R4 == 0
      !insertmacro panacodeFail 72 "Could not create a fresh staging directory."
    ${EndIf}
    !ifdef COMPRESS
      SetCompress off
    !endif
    File "/oname=$PLUGINSDIR\panacode-payload.7z" "${STAGED_PACKAGE}"
    !ifdef COMPRESS
      SetCompress "${COMPRESS}"
    !endif
    SetOutPath "$panacodeStage"
    Nsis7z::Extract "$PLUGINSDIR\panacode-payload.7z"
    SetOutPath $PLUGINSDIR
    !insertmacro panacodeFiles Stage "$panacodeStage" "${PANACODE_BUILD_SHA256}" $R4
    ${If} $R4 != 0
      ; Preserve the failing phase in silent mode (100 + helper result).
      IntOp $R4 $R4 + 100
      !insertmacro panacodeFail $R4 "The extracted Panacode build is incomplete or changed. The previous installation is intact."
    ${EndIf}
    !if "${PUBLISH}" == "publish"
      StrCpy $R6 "${STAGED_PACKAGE_HASH}" 16
      ClearErrors
      Rename "$panacodeStage" "$INSTDIR.update-$R6"
      ${If} ${Errors}
        !insertmacro panacodeFail 74 "Could not publish the verified staging directory."
      ${EndIf}
    !endif
    panacodeStageReady_${PUBLISH}:
  !macroend

  !macro preInit
    ${StdUtils.TestParameter} $R0 "stage"
    ${If} $R0 == "true"
      !ifmacrodef check64BitAndSetRegView
        !insertmacro check64BitAndSetRegView
      !endif
      ReadRegStr $INSTDIR HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
      ${If} $INSTDIR == ""
      ${OrIfNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
        SetErrorLevel 2
        Quit
      ${EndIf}
      !insertmacro customInit
      !insertmacro panacodePrepareStage publish
      SetErrorLevel 0
      Quit
    ${EndIf}
  !macroend

  ; Both cached and ordinary upgrades use the same verified, complete tree. Never decompress
  ; over a live installation or follow a replaced file in it. Preserve unknown/legacy files
  ; in the old directory; only a previous installation with a recorded receipt may be cleaned.
  !macro customInstallStagedApp
    !insertmacro panacodePrepareStage install
    ; The installer and its icon are generated after packaging the payload. Materialize them
    ; in the verified stage before moving the previous install or updating any registry entry.
    SetOutPath "$panacodeStage"
    ClearErrors
    !ifdef UNINSTALLER_OUT_FILE
      File "/oname=${UNINSTALL_FILENAME}" "${UNINSTALLER_OUT_FILE}"
    !else
      WriteUninstaller "$panacodeStage\${UNINSTALL_FILENAME}"
    !endif
    !ifdef UNINSTALLER_ICON
      File /oname=uninstallerIcon.ico "${UNINSTALLER_ICON}"
    !endif
    ${If} ${Errors}
      !insertmacro panacodeFail 75 "Could not prepare the uninstaller. Your installation is intact."
    ${EndIf}
    ${StdUtils.HashFile} $panacodeNewUninstallerPin "SHA2-256" "$panacodeStage\${UNINSTALL_FILENAME}"
    StrLen $R4 $panacodeNewUninstallerPin
    ${If} $R4 != 64
      !insertmacro panacodeFail 76 "Could not verify the packaged uninstaller."
    ${EndIf}
    StrCpy $panacodeNewIconPin ""
    !ifdef UNINSTALLER_ICON
      ${StdUtils.HashFile} $panacodeNewIconPin "SHA2-256" "$panacodeStage\uninstallerIcon.ico"
      StrLen $R4 $panacodeNewIconPin
      ${If} $R4 != 64
        !insertmacro panacodeFail 77 "Could not verify the packaged uninstaller icon."
      ${EndIf}
    !endif
    nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$panacodeStage" /grant "*S-1-15-2-2:(OI)(CI)(RX)"'
    Pop $R4
    ${If} $R4 != 0
      !insertmacro panacodeFail 78 "Windows could not grant sandbox access. Your installation is intact."
    ${EndIf}
    SetOutPath $PLUGINSDIR
    ${If} $panacodeShared != ""
      StrCpy $INSTDIR "$panacodeShared"
    ${EndIf}
    !insertmacro customInit
    !insertmacro panacodeDirIsEmpty "$INSTDIR" $R6
    ${If} $R6 == 0
      StrCpy $panacodeBackup "$INSTDIR.old"
      System::Call 'kernel32::GetFileAttributesW(w "$panacodeBackup") i .R4'
      ${If} $R4 != -1
        System::Call "kernel32::GetCurrentProcessId() i .R4"
        StrCpy $panacodeBackup "$INSTDIR.old-$R4"
      ${EndIf}
      ClearErrors
      Rename "$INSTDIR" "$panacodeBackup"
      ${If} ${Errors}
        !insertmacro panacodeFail 79 "Close the application in the installation folder and retry. Its files are intact."
      ${EndIf}
    ${Else}
      RMDir "$INSTDIR"
    ${EndIf}
    !insertmacro panacodePathIsContained "$INSTDIR" $R4
    ${If} $R4 != 1
      ; Never traverse the substituted destination to clean or restore it.
      !insertmacro panacodeFail 80 "Windows changed the final folder. The previous build is retained at $panacodeBackup."

    ${EndIf}
    ClearErrors
    Rename "$panacodeStage" "$INSTDIR"
    ${If} ${Errors}
      ${If} $panacodeBackup != ""
        ClearErrors
        Rename "$panacodeBackup" "$INSTDIR"
        ${If} ${Errors}
          !insertmacro panacodeFail 81 "The previous installation could not be restored. Its files are retained at $panacodeBackup."
        ${EndIf}
      ${EndIf}
      !insertmacro panacodeFail 82 "Could not activate the verified Panacode build."
    ${EndIf}
    SetOutPath "$INSTDIR"
    StrCpy $R0 "installed"
  !macroend
!endif
!endif
