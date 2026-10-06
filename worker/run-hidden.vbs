' Runs run-forever.cmd with no window (Task Scheduler starts this at sign-in).
Set sh = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "cmd /c """ & dir & "\run-forever.cmd""", 0, True
