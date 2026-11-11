Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
scriptsDir = fso.GetParentFolderName(WScript.ScriptFullName)
rootDir = fso.GetParentFolderName(scriptsDir)
shell.CurrentDirectory = rootDir
shell.Run "node.exe """ & rootDir & "\server.js""", 0, False
