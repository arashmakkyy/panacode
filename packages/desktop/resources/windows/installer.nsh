; Windows installation ownership.
;
; electron-builder names a one-click per-user install directory after the package name, which every
; channel shares. Each channel now installs into a directory named after its app ID, like its data
; directory. An executable or marker in a directory is not proof that the directory belongs to this
; app: ownership must come from this app's registry entry plus the manifest written at build time.
; Unknown files are never deleted, directories are only removed when empty, and an old uninstaller is
; never executed because it may delete the shared tree.

; Registers used by the ownership helpers. Macro callers must not keep live values there across calls:
;   $R0-$R3, $R8-$R9  manifest and path checks
;   $0-$9             manifest file walk
!ifndef BUILD_UNINSTALLER
  Var /GLOBAL panacodeShared
  Var /GLOBAL panacodeSharedOwned
  Var /GLOBAL panacodeVerified
!endif

; Lexically canonicalizes a path and drops a trailing separator unless the path is a root.
; NSIS GetFullPathName returns an empty string for a path that does not exist yet, which is exactly
; the fresh-install case, so this uses StdUtils instead.
!macro panacodeCanonicalize INPUT OUTPUT
  ${StdUtils.NormalizePath} ${OUTPUT} "${INPUT}"
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
    System::Call 'kernel32::GetFileAttributesW(w "$R0") i .R1'
    ${If} $R1 != -1
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

; Reads one line and removes its trailing line ending. NSIS FileRead keeps "\r\n" or "\n", so a
; direct comparison with a manifest line never matches. Clobbers $R7.
!macro panacodeReadLine HANDLE RESULT
  FileRead ${HANDLE} ${RESULT}
  StrCpy $R7 ${RESULT} 1 -1
  ${If} $R7 == "$\n"
    StrCpy ${RESULT} ${RESULT} -1
  ${EndIf}
  StrCpy $R7 ${RESULT} 1 -1
  ${If} $R7 == "$\r"
    StrCpy ${RESULT} ${RESULT} -1
  ${EndIf}
!macroend

; Reads a build-time manifest. Sets RESULT to 1 only when the header, app ID and executable name
; match this build, and leaves the recorded version in $R0. RESULT must be outside $R0-$R3.
!macro panacodeValidateManifest DIR RESULT
  StrCpy ${RESULT} 0
  StrCpy $R0 ""
  ${If} ${FileExists} "${DIR}\.panacode-install"
    ClearErrors
    FileOpen $R1 "${DIR}\.panacode-install" r
    ${IfNot} ${Errors}
      !insertmacro panacodeReadLine $R1 $R2
      ${If} $R2 == "panacode-install 1"
        !insertmacro panacodeReadLine $R1 $R2
        ${If} $R2 == "app=${APP_ID}"
          !insertmacro panacodeReadLine $R1 $R2
          StrCpy $R3 $R2 8
          ${If} $R3 == "version="
            StrCpy $R0 $R2 "" 8
            ${If} $R0 != ""
              !insertmacro panacodeReadLine $R1 $R2
              ${If} $R2 == "exe=${APP_EXECUTABLE_FILENAME}"
                StrCpy ${RESULT} 1
              ${EndIf}
            ${EndIf}
          ${EndIf}
        ${EndIf}
      ${EndIf}
      FileClose $R1
    ${EndIf}
  ${EndIf}
!macroend

; Deletes only the manifest's files when their recorded size still matches, and prunes directories
; that became empty. A reparse point in a file's ancestry stops that entry. Unknown files stay.
!macro panacodeRemoveManifestFiles DIR
  ClearErrors
  FileOpen $9 "${DIR}\.panacode-install" r
  ${IfNot} ${Errors}
    !insertmacro panacodeReadLine $9 $8
    !insertmacro panacodeReadLine $9 $8
    !insertmacro panacodeReadLine $9 $8
    !insertmacro panacodeReadLine $9 $8
    ${Do}
      !insertmacro panacodeReadLine $9 $8
      ${If} $8 == ""
        ${ExitDo}
      ${EndIf}
      !insertmacro panacodeReadLine $9 $7
      ${If} $7 == ""
        ${ExitDo}
      ${EndIf}

      ; A manifest path is a relative path below DIR. Reject traversal, absolutes and drive paths.
      StrCpy $6 0
      ${Do}
        StrCpy $5 $7 2 $6
        ${If} $5 == ".."
          StrCpy $8 ""
          ${ExitDo}
        ${EndIf}
        IntOp $6 $6 + 1
        StrLen $5 $7
        ${If} $6 >= $5
          ${ExitDo}
        ${EndIf}
      ${Loop}
      ${If} $8 == ""
        ${ExitDo}
      ${EndIf}
      StrCpy $5 $7 1
      ${If} $5 == "\"
        ${ExitDo}
      ${EndIf}
      StrCpy $5 $7 1 1
      ${If} $5 == ":"
        ${ExitDo}
      ${EndIf}

      ${StdUtils.GetParentPath} $4 "${DIR}\$7"
      !insertmacro panacodePathIsContained "$4" $3
      ${If} $3 == 1
        ${If} ${FileExists} "${DIR}\$7"
          ClearErrors
          FileOpen $6 "${DIR}\$7" r
          ${IfNot} ${Errors}
            FileSeek $6 0 END $5
            FileClose $6
            ${If} $5 == $8
              Delete "${DIR}\$7"
            ${EndIf}
          ${EndIf}
        ${EndIf}

        ; Remove only directories that the deleted files left empty, never recursively.
        ${StdUtils.GetParentPath} $4 "${DIR}\$7"
        ${Do}
          ${If} $4 == "${DIR}"
            ${ExitDo}
          ${EndIf}
          RMDir "$4"
          ${StdUtils.GetParentPath} $3 "$4"
          ${If} $3 == $4
            ${ExitDo}
          ${EndIf}
          ${If} $3 == ""
            ${ExitDo}
          ${EndIf}
          StrCpy $4 $3
        ${Loop}
      ${EndIf}
    ${Loop}
    FileClose $9
  ${EndIf}
!macroend

; Removes a directory only when its manifest belongs to this app. Used for the old shared directory
; and for a previous install left behind by an interrupted staged update.
!macro panacodeRemoveOwnedDir DIR
  !insertmacro panacodeValidateManifest "${DIR}" $R4
  ${If} $R4 == 1
    !insertmacro panacodeRemoveManifestFiles "${DIR}"
    Delete "${DIR}\.panacode-install"
    Delete "${DIR}\${UNINSTALL_FILENAME}"
    Delete "${DIR}\uninstallerIcon.ico"
    RMDir "${DIR}"
  ${EndIf}
!macroend

; A private staging directory created by this process. Recursive removal is safe only after proving
; that no reparse point was planted inside it.
!macro panacodeDiscardPrivateStage DIR
  !insertmacro panacodePathIsContained "${DIR}" $R4
  ${If} $R4 == 1
    RMDir /r "${DIR}"
  ${EndIf}
!macroend

!macro panacodeRefuse REASON
  ${IfNot} ${Silent}
    MessageBox MB_OK|MB_ICONSTOP "${REASON}"
  ${EndIf}
  SetErrorLevel 5
  Quit
!macroend

; Refuses the protected directory itself and any of its ancestors. Descendants stay allowed, so the
; default per-user install under LocalAppData\Programs keeps working.
!macro panacodeRefuseProtected PATH
  ${If} $INSTDIR == "${PATH}"
    !insertmacro panacodeRefuse "Panacode cannot install directly into a protected system or profile folder. Choose a private folder."
  ${EndIf}
  StrLen $R0 $INSTDIR
  IntOp $R0 $R0 + 1
  StrCpy $R1 "${PATH}" $R0
  ${If} $R1 == "$INSTDIR\"
    !insertmacro panacodeRefuse "Panacode cannot install into a folder that contains a protected system or profile folder. Choose a private folder."
  ${EndIf}
!macroend

!macro customInit
  StrCpy $panacodeShared ""
  StrCpy $panacodeSharedOwned "0"
  StrCpy $panacodeVerified "0"

  !insertmacro panacodeCanonicalize "$INSTDIR" $INSTDIR

  ${If} $INSTDIR == ""
    !insertmacro panacodeRefuse "Panacode cannot use an empty installation folder. Choose a private folder."
  ${EndIf}

  StrCpy $R0 $INSTDIR 2
  ${If} $R0 == "\\"
    !insertmacro panacodeRefuse "Panacode cannot install to a network share. Choose a local private folder."
  ${EndIf}

  StrLen $R0 $INSTDIR
  ${If} $R0 <= 3
    StrCpy $R1 $INSTDIR 1 1
    ${If} $R1 == ":"
      !insertmacro panacodeRefuse "Panacode cannot install into a drive root. Choose a private folder."
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
    !insertmacro panacodeRefuse "Panacode cannot install through a junction or symbolic link. Choose a real local folder."
  ${EndIf}

  ; Move a shared default path to this channel's private path. The shared directory is this app's
  ; only when its own registry entry points at it; a manifest is needed before any file in it is
  ; deleted or any process from it is stopped.
  ${StdUtils.GetParentPath} $R0 "$INSTDIR"
  ${If} $INSTDIR == "$R0\${APP_FILENAME}"
    StrCpy $INSTDIR "$R0\${APP_ID}"
    ReadRegStr $R1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    !insertmacro panacodeCanonicalize "$R1" $R8
    ${If} $R8 == "$R0\${APP_FILENAME}"
      ; A pre-manifest install is this app's, but its individual files are not provably ours, so
      ; nothing in it is deleted or terminated. Only the registry entry and shortcuts move.
      StrCpy $panacodeShared "$R0\${APP_FILENAME}"
      !insertmacro panacodeValidateManifest "$panacodeShared" $R4
      ${If} $R4 == 1
        StrCpy $panacodeSharedOwned "1"
      ${EndIf}
    ${EndIf}
  ${EndIf}

  ; A different existing install location is left alone. The old uninstaller is never executed, so
  ; installing a second copy would orphan the first one without an owner that can clean it.
  ReadRegStr $R1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  !insertmacro panacodeCanonicalize "$R1" $R8
  ${If} $R8 != ""
  ${AndIf} $R8 != "$INSTDIR"
  ${AndIf} $R8 != "$panacodeShared"
    System::Call 'kernel32::GetFileAttributesW(w "$R8") i .R9'
    ${If} $R9 != -1
      !insertmacro panacodeRefuse "Panacode is already installed in another folder. Uninstall it before choosing a different folder."
    ${EndIf}
  ${EndIf}

  StrCpy $R5 0
  !insertmacro panacodeValidateManifest "$INSTDIR" $R4
  ${If} $R4 == 1
    StrCpy $R5 1
    StrCpy $panacodeVerified "1"
  ${ElseIf} $R8 == "$INSTDIR"
  ${AndIf} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ; Installs made before the manifest existed are proven by this app's registry entry and executable.
    ; That is enough to install over them, never to delete their files.
    StrCpy $R5 1
  ${EndIf}

  ; A non-empty target without proof is foreign. Refuse before registry, shortcut, ACL or file changes.
  StrCpy $R6 1
  System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR") i .R9'
  ${If} $R9 != -1
    IntOp $R7 $R9 & 0x10
    ${If} $R7 == 0
      !insertmacro panacodeRefuse "The installation path is a file, not a folder. Choose a private folder."
    ${EndIf}
    !insertmacro panacodeDirIsEmpty "$INSTDIR" $R6
  ${EndIf}
  ${If} $R6 == 0
  ${AndIf} $R5 == 0
    !insertmacro panacodeRefuse "This folder contains files that do not belong to this Panacode installation. Choose an empty folder or a folder owned by Panacode."
  ${EndIf}

  ; Never run an uninstaller from the registry: older versions may delete a shared install tree.
  ; The stock installer skips its old-uninstaller step when these values are absent.
  DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" UninstallString
  DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
  DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" UninstallString
  DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" QuietUninstallString
  !ifdef UNINSTALL_REGISTRY_KEY_2
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
    DeleteRegValue SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY_2}" QuietUninstallString
    DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY_2}" UninstallString
    DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY_2}" QuietUninstallString
  !endif
!macroend

!macro customInstall
  ; Chromium's sandbox needs read/execute access to the installed runtime files.
  ; https://github.com/electron/electron/issues/49143#issuecomment-3618354787
  nsExec::ExecToLog '"$SYSDIR\icacls.exe" "$INSTDIR" /grant "*S-1-15-2-2:(OI)(CI)(RX)"'
  Pop $0
  !insertmacro leaveSharedInstall
!macroend

; Removes this channel's files from a shared directory only when this build's manifest proves them.
; A pre-manifest shared install keeps every file, because deleting the shared executable or
; uninstaller by name would erase whichever other channel installed them last.
!macro leaveSharedInstall
  ${If} $panacodeShared != ""
    !insertmacro panacodeRemoveOwnedDir "$panacodeShared"

    ; A taskbar pin still starts the old executable, so this app's own pin is pointed at the new one.
    ${If} ${FileExists} "$QUICKLAUNCH\User Pinned\TaskBar\${SHORTCUT_NAME}.lnk"
      CreateShortCut "$QUICKLAUNCH\User Pinned\TaskBar\${SHORTCUT_NAME}.lnk" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
      WinShell::SetLnkAUMI "$QUICKLAUNCH\User Pinned\TaskBar\${SHORTCUT_NAME}.lnk" "${APP_ID}"
    ${EndIf}
  ${EndIf}
!macroend

; Replaces the stock recursive removal in the uninstaller. Only a manifest-verified installation is
; touched; an unknown path aborts instead of deleting whatever happens to be there.
!macro customRemoveFiles
  !insertmacro panacodeCanonicalize "$INSTDIR" $INSTDIR

  ReadRegStr $R2 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  !insertmacro panacodeCanonicalize "$R2" $R8
  !insertmacro panacodeValidateManifest "$INSTDIR" $R4
  !insertmacro panacodePathIsContained "$INSTDIR" $R5
  ${If} $R4 == 1
  ${AndIf} $R8 == "$INSTDIR"
  ${AndIf} $R5 == 1
    !insertmacro panacodeRemoveManifestFiles "$INSTDIR"
    Delete "$INSTDIR\.panacode-install"
    Delete "$INSTDIR\${UNINSTALL_FILENAME}"
    Delete "$INSTDIR\uninstallerIcon.ico"
    RMDir "$INSTDIR"
    ; A staged update that lost power between the two renames leaves a manifest-verified old tree.
    !insertmacro panacodeRemoveOwnedDir "$INSTDIR.old"
    ; A stage downloaded for this exact build is ours to remove. Any other sibling name stays.
    !ifdef APP_64_HASH
      StrCpy $R6 "${APP_64_HASH}" 16
      !insertmacro panacodeRemoveOwnedDir "$INSTDIR.update-$R6"
    !endif
    !ifdef APP_ARM64_HASH
      StrCpy $R6 "${APP_ARM64_HASH}" 16
      !insertmacro panacodeRemoveOwnedDir "$INSTDIR.update-$R6"
    !endif
  ${Else}
    ${IfNot} ${Silent}
      MessageBox MB_OK|MB_ICONSTOP "Panacode could not verify this installation folder, so it did not remove any files."
    ${EndIf}
    Abort
  ${EndIf}
!macroend

; The stock check starts Windows PowerShell up to five times per installer and again in the old
; uninstaller, about 1.2 s each. This walks the process list in-process instead. It stops only a
; process whose image is exactly this installation's executable, using the same handle that proved
; the image, so helpers in the install tree and lookalike paths stay alive.
!macro customCheckAppRunning
  !insertmacro panacodeCanonicalize "$INSTDIR" $INSTDIR

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
              StrCpy $2 0
              ${If} $R5 == "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
                StrCpy $2 1
              ${EndIf}
              !ifndef BUILD_UNINSTALLER
                ${If} $panacodeSharedOwned == 1
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
        StrCpy $R8 0
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

; Staged updates. Once an update has downloaded, the running app starts its installer with --stage.
; That unpacks the app next to the install directory, as "<install dir>.update-<payload hash>",
; while the user keeps working. After the restart, the install renames that directory into place
; instead of decompressing 700 MB. Anything unexpected falls back to the normal extraction.
!ifndef BUILD_UNINSTALLER
!ifdef APP_64 | APP_ARM64
  !ifdef APP_64 & APP_ARM64
    !error "Staged updates expect one architecture per installer"
  !endif
  !ifdef APP_ARM64
    !define STAGED_PACKAGE "${APP_ARM64}"
    !define STAGED_PACKAGE_HASH "${APP_ARM64_HASH}"
    !define STAGED_PACKAGE_SIZE "${APP_ARM64_UNPACKED_SIZE}"
  !else
    !define STAGED_PACKAGE "${APP_64}"
    !define STAGED_PACKAGE_HASH "${APP_64_HASH}"
    !define STAGED_PACKAGE_SIZE "${APP_64_UNPACKED_SIZE}"
  !endif

  ; Runs first in .onInit, before the single-instance check, and exits 0 only when it staged.
  !macro preInit
    ${StdUtils.TestParameter} $R0 "stage"
    ${If} $R0 == "true"
      SetErrorLevel 2
      ReadRegStr $R1 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
      !insertmacro panacodeCanonicalize "$R1" $R5
      ${If} $R5 != ""
        !insertmacro panacodePathIsContained "$R5" $R3
        ${If} $R3 == 1
          !insertmacro panacodeValidateManifest "$R5" $R8
          ${If} $R8 == 1
          ${OrIf} ${FileExists} "$R5\${APP_EXECUTABLE_FILENAME}"
            ; Stage beside the private directory the install will use, not inside a shared one.
            ${StdUtils.GetParentPath} $R2 "$R5"
            ${If} $R5 == "$R2\${APP_FILENAME}"
              StrCpy $R2 "$R2\${APP_ID}"
            ${Else}
              StrCpy $R2 "$R5"
            ${EndIf}

            StrCpy $R4 0
            System::Call 'kernel32::GetFileAttributesW(w "$R2") i .R9'
            ${If} $R9 != -1
              IntOp $R9 $R9 & 0x10
              ${If} $R9 == 0
                StrCpy $R4 1
              ${Else}
                !insertmacro panacodeDirIsEmpty "$R2" $R6
                ${If} $R6 == 0
                  StrCpy $R4 1
                ${EndIf}
              ${EndIf}
            ${EndIf}
            ; A non-empty target that is not the recorded install is foreign; never stage into it.
            ${If} $R4 == 1
            ${AndIf} $R2 != "$R5"
              ${If} $R8 != 1
                ${IfNot} ${FileExists} "$R2\${APP_EXECUTABLE_FILENAME}"
                  StrCpy $R5 ""
                ${EndIf}
              ${EndIf}
            ${EndIf}

            ${If} $R5 != ""
              ; The stage is created beside $R2, so free space belongs to the parent when the private
              ; target does not exist yet (a shared install migrating to its channel directory).
              ${DriveSpace} "$R2" "/D=F /S=M" $R6
              ${If} $R6 == ""
                ${StdUtils.GetParentPath} $R6 "$R2"
                ${DriveSpace} "$R6" "/D=F /S=M" $R6
              ${EndIf}
              IntOp $R7 ${STAGED_PACKAGE_SIZE} / 512
              ${If} $R6 > $R7
                System::Call "kernel32::GetCurrentProcessId() i .R3"
                StrCpy $R6 "$R2.staging-$R3"
                System::Call 'kernel32::GetFileAttributesW(w "$R6") i .R9'
                ${If} $R9 == -1
                  ClearErrors
                  CreateDirectory "$R6"
                  ${IfNot} ${Errors}
                    InitPluginsDir
                    ; Stored like the template's copy, so the installer keeps one copy of the payload.
                    !ifdef COMPRESS
                      SetCompress off
                    !endif
                    File /oname=$PLUGINSDIR\staged.7z "${STAGED_PACKAGE}"
                    !ifdef COMPRESS
                      SetCompress "${COMPRESS}"
                    !endif
                    ClearErrors
                    SetOutPath "$R6"
                    ${IfNot} ${Errors}
                      Nsis7z::Extract "$PLUGINSDIR\staged.7z"
                      SetOutPath $PLUGINSDIR
                    ${EndIf}
                    ; The validator clobbers $R2, so keep the stage parent across it.
                    Push $R2
                    !insertmacro panacodeValidateManifest "$R6" $R9
                    Pop $R2
                    ${If} $R9 == 1
                    ${AndIf} $R0 == "${VERSION}"
                      StrCpy $R7 "${STAGED_PACKAGE_HASH}" 16
                      StrCpy $R7 "$R2.update-$R7"
                      System::Call 'kernel32::GetFileAttributesW(w "$R7") i .R9'
                      ${If} $R9 != -1
                        ; An existing stage is reused only when it belongs to this exact build.
                        !insertmacro panacodeValidateManifest "$R7" $R9
                        ${If} $R9 == 1
                        ${AndIf} $R0 == "${VERSION}"
                          SetErrorLevel 0
                        ${EndIf}
                        !insertmacro panacodeDiscardPrivateStage "$R6"
                      ${Else}
                        ClearErrors
                        Rename "$R6" "$R7"
                        ${IfNot} ${Errors}
                          SetErrorLevel 0
                        ${Else}
                          !insertmacro panacodeDiscardPrivateStage "$R6"
                        ${EndIf}
                      ${EndIf}
                    ${Else}
                      !insertmacro panacodeDiscardPrivateStage "$R6"
                    ${EndIf}
                  ${EndIf}
                ${EndIf}
              ${EndIf}
            ${EndIf}
          ${EndIf}
        ${EndIf}
      ${EndIf}
      Quit
    ${EndIf}
  !macroend

  ; Called by the patched app-builder-lib template in place of extraction. Sets $R0 to "installed"
  ; when it moved the staged app into place.
  !macro customInstallStagedApp
    StrCpy $R0 ""
    StrCpy $R6 "${STAGED_PACKAGE_HASH}" 16
    StrCpy $R7 "$INSTDIR.update-$R6"
    ; The validator clobbers $R7, so keep the stage path across it.
    Push $R7
    !insertmacro panacodeValidateManifest "$R7" $R8
    Pop $R7
    ${If} $R8 == 1
    ${AndIf} $R0 == "${VERSION}"
    ${AndIf} ${FileExists} "$R7\${APP_EXECUTABLE_FILENAME}"
      !insertmacro panacodePathIsContained "$INSTDIR" $R9
      !insertmacro panacodePathIsContained "$R7" $R5
      ${If} $R9 == 1
      ${AndIf} $R5 == 1
        StrCpy $R4 1
        System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR") i .R9'
        ${If} $R9 != -1
          !insertmacro panacodeDirIsEmpty "$INSTDIR" $R4
        ${EndIf}

        ${If} $R4 == 1
          ; An interrupted attempt can leave a manifest-verified tree beside an empty target.
          !insertmacro panacodeRemoveOwnedDir "$INSTDIR.old"
          ; The removal helper clobbers $R7, so restore the stage path before renaming it.
          StrCpy $R7 "$INSTDIR.update-$R6"
          RMDir "$INSTDIR"
          ClearErrors
          Rename "$R7" "$INSTDIR"
          ${IfNot} ${Errors}
            StrCpy $R0 "installed"
          ${EndIf}
        ${ElseIf} $panacodeVerified == 1
          ; Move the previous manifest-verified install aside, then rename the staged build into
          ; place. A previous tree that still holds unknown files is not touched.
          !insertmacro panacodeRemoveOwnedDir "$INSTDIR.old"
          StrCpy $R7 "$INSTDIR.update-$R6"
          System::Call 'kernel32::GetFileAttributesW(w "$INSTDIR.old") i .R9'
          ${If} $R9 == -1
            ClearErrors
            Rename "$INSTDIR" "$INSTDIR.old"
            ${IfNot} ${Errors}
              RMDir "$INSTDIR"
              ClearErrors
              Rename "$R7" "$INSTDIR"
              ${IfNot} ${Errors}
                ; The cleanup helper writes $R0, so the success marker is set after it.
                !insertmacro panacodeRemoveOwnedDir "$INSTDIR.old"
                StrCpy $R0 "installed"
              ${Else}
                ; The stage could not move; put the previous install back before extraction.
                Rename "$INSTDIR.old" "$INSTDIR"
              ${EndIf}
            ${EndIf}
          ${EndIf}
        ${EndIf}
      ${EndIf}
    ${EndIf}
    ; Path helpers write $R0; a caller may only observe the two documented values.
    ${If} $R0 != "installed"
      StrCpy $R0 ""
    ${EndIf}
    SetOutPath $INSTDIR
  !macroend
!endif
!endif
