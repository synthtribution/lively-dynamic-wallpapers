Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptsDir = fso.GetParentFolderName(WScript.ScriptFullName)
rootDir = fso.GetParentFolderName(scriptsDir)
shell.CurrentDirectory = rootDir
nodeExe = "node.exe"
If fso.FileExists("C:\Program Files\nodejs\node.exe") Then
  nodeExe = "C:\Program Files\nodejs\node.exe"
End If
shell.Run """" & nodeExe & """ """ & rootDir & "\server.js""", 0, False
