; KAW'S ATS Playground Companion - Windows installer (Inno Setup 6.4+ / 7).
; Build: ISCC.exe /DStage=<staging folder> /DOut=<output folder> installer\KAW-ATS-Companion.iss
; The staging folder holds KAW-Companion-Launcher.exe, KAW-ATS-Companion.ico, QUICK-START.txt,
; THIRD-PARTY-NOTICES.txt, runtime\node.exe, plugin\scs-telemetry.dll and companion\ (src, public,
; node_modules, package.json, config.example.json). Never put a config.json in the staging folder.

#define AppName "KAW'S ATS Playground Companion"
#define AppVersion "1.7.2"
#ifndef Stage
  #define Stage "..\build\stage"
#endif
#ifndef Out
  #define Out "..\dist"
#endif

[Setup]
; Same AppId as v1.3-v1.5.1 so the update installs over the existing copy and keeps its settings.
AppId={{A9468B4F-50E8-4A1D-92EE-C6D7D3B219C1}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=KAW'S ATS Playground
DefaultDirName={autopf}\KAW ATS Companion
DefaultGroupName=KAW'S ATS Playground
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir={#Out}
OutputBaseFilename=KAW-ATS-Companion-Setup-v{#AppVersion}
SetupIconFile={#Stage}\KAW-ATS-Companion.ico
UninstallDisplayIcon={app}\KAW-ATS-Companion.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=force
DisableProgramGroupPage=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"
Name: "startup"; Description: "Start the Companion quietly when Windows starts"
Name: "telemetryplugin"; Description: "Install the ATS telemetry plugin (needed for live gauges)"
Name: "lanaccess"; Description: "Allow phones and tablets on my private Wi-Fi to open the dashboard"; Flags: unchecked

[Files]
Source: "{#Stage}\KAW-Companion-Launcher.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Stage}\KAW-ATS-Companion.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Stage}\QUICK-START.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Stage}\THIRD-PARTY-NOTICES.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Stage}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs
Source: "{#Stage}\plugin\*"; DestDir: "{app}\plugin"; Flags: ignoreversion recursesubdirs
Source: "{#Stage}\companion\*"; DestDir: "{app}\companion"; Excludes: "\config.json,\data\*,\logs\*"; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
Name: "{app}\companion\data"
Name: "{app}\logs"

[UninstallDelete]
Type: files; Name: "{app}\firewall-rule.txt"

[Icons]
Name: "{group}\KAW'S ATS Companion"; Filename: "{app}\KAW-Companion-Launcher.exe"; WorkingDir: "{app}"; IconFilename: "{app}\KAW-ATS-Companion.ico"
Name: "{group}\Companion Settings"; Filename: "{app}\KAW-Companion-Launcher.exe"; WorkingDir: "{app}"; IconFilename: "{app}\KAW-ATS-Companion.ico"
Name: "{group}\Install ATS Telemetry Plugin"; Filename: "{app}\KAW-Companion-Launcher.exe"; Parameters: "--install-plugin"; WorkingDir: "{app}"
Name: "{group}\KAW ATS Companion Logs"; Filename: "{win}\explorer.exe"; Parameters: """{app}\logs"""
Name: "{group}\Companion Quick Start"; Filename: "{app}\QUICK-START.txt"
Name: "{group}\Uninstall KAW ATS Companion"; Filename: "{uninstallexe}"
Name: "{autodesktop}\KAW'S ATS Companion"; Filename: "{app}\KAW-Companion-Launcher.exe"; WorkingDir: "{app}"; IconFilename: "{app}\KAW-ATS-Companion.ico"; Tasks: desktopicon
Name: "{userstartup}\KAW ATS Companion"; Filename: "{app}\KAW-Companion-Launcher.exe"; Parameters: "--no-browser"; WorkingDir: "{app}"; Tasks: startup

[Run]
Filename: "{app}\KAW-Companion-Launcher.exe"; Parameters: "--install-plugin"; StatusMsg: "Installing the ATS telemetry plugin..."; Tasks: telemetryplugin; Flags: waituntilterminated
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""KAW ATS Companion"" dir=in action=allow protocol=TCP localport=4280 profile=private"; Verb: "runas"; StatusMsg: "Allowing Wi-Fi access (private networks only)..."; Tasks: lanaccess; Flags: shellexec runhidden waituntilterminated
Filename: "{app}\KAW-Companion-Launcher.exe"; Description: "Open KAW'S ATS Companion now"; WorkingDir: "{app}"; Flags: postinstall nowait skipifsilent

[UninstallRun]
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""KAW ATS Companion"""; Verb: "runas"; Flags: shellexec runhidden waituntilterminated; RunOnceId: "KawFirewall"; Check: FirewallRuleWasAdded

[Code]
var
  DriverPage: TInputQueryWizardPage;

function ConfigPath(): String;
begin
  Result := ExpandConstant('{app}\companion\config.json');
end;

function LegacyScriptPath(): String;
begin
  Result := ExpandConstant('{localappdata}\KAW-ATS-Companion');
end;

procedure CopyLegacyData(Source, Destination: String);
var
  Item: TFindRec;
begin
  if not DirExists(Source) then Exit;
  if not ForceDirectories(Destination) then RaiseException('Could not create the data folder.');
  if FindFirst(Source + '\*', Item) then
  begin
    try
      repeat
        if (Item.Name <> '.') and (Item.Name <> '..') and
          ((Item.Attributes and $00000400) = 0) then
        begin
          if (Item.Attributes and FILE_ATTRIBUTE_DIRECTORY) <> 0 then
            CopyLegacyData(Source + '\' + Item.Name, Destination + '\' + Item.Name)
          else if not FileExists(Destination + '\' + Item.Name) then
            if not FileCopy(Source + '\' + Item.Name, Destination + '\' + Item.Name, True) then
              RaiseException('Could not copy existing Companion data. The original is unchanged.');
        end;
      until not FindNext(Item);
    finally
      FindClose(Item);
    end;
  end;
end;

procedure InitializeWizard();
begin
  DriverPage := CreateInputQueryPage(wpSelectTasks, 'Driver name', 'What should convoy mates see?',
    'Enter your driver or call-sign name. You can change it later in the Companion settings.');
  DriverPage.Add('Driver / call-sign:', False);
  DriverPage.Values[0] := GetUserNameString();
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  { Updating: keep the existing settings, no need to ask again. }
  Result := (PageID = DriverPage.ID) and
    (FileExists(ConfigPath()) or FileExists(LegacyScriptPath() + '\config.json'));
end;

function JsonEscape(S: String): String;
begin
  StringChangeEx(S, '\', '\\', True);
  StringChangeEx(S, '"', '\"', True);
  Result := S;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Json: AnsiString;
  Text, Name: String;
  Lines: TArrayOfString;
begin
  if CurStep <> ssPostInstall then Exit;
  { Remember the firewall rule so the uninstaller removes it. }
  if WizardIsTaskSelected('lanaccess') then
    SaveStringToFile(ExpandConstant('{app}\firewall-rule.txt'), 'KAW ATS Companion', False);
  { New install: write config.json from the example. Updates keep theirs (the app migrates old relay URLs). }
  if FileExists(ConfigPath()) then Exit;
  { Migrate the previous script installer without deleting or overwriting its files. }
  if FileExists(LegacyScriptPath() + '\config.json') then
  begin
    CopyLegacyData(LegacyScriptPath() + '\data', ExpandConstant('{app}\companion\data'));
    if not FileCopy(LegacyScriptPath() + '\config.json', ConfigPath(), True) then
      RaiseException('Could not copy existing Companion settings. The original is unchanged.');
    Exit;
  end;
  if not LoadStringFromFile(ExpandConstant('{app}\companion\config.example.json'), Json) then Exit;
  Text := String(Json);
  Name := Trim(DriverPage.Values[0]);
  if Name = '' then Name := 'ATS Driver';
  if Length(Name) > 40 then Name := Copy(Name, 1, 40);
  StringChangeEx(Text, '"driverName": "ATS Driver"', '"driverName": "' + JsonEscape(Name) + '"', True);
  if WizardIsTaskSelected('lanaccess') then
    StringChangeEx(Text, '"dashboardHost": "127.0.0.1"', '"dashboardHost": "0.0.0.0"', True);
  SetArrayLength(Lines, 1);
  Lines[0] := Text;
  SaveStringsToUTF8File(ConfigPath(), Lines, False);
end;

function FirewallRuleWasAdded(): Boolean;
begin
  Result := FileExists(ExpandConstant('{app}\firewall-rule.txt'));
end;
