Download **KAW-ATS-Companion-Setup-v1.7.2.exe** below and run it on Windows 10/11 x64.

Drivers do **not** need to install Node.js, Python, npm, Visual Studio or C++ Build Tools. Setup includes its own private Node.js runtime, prebuilt telemetry module and ATS telemetry plugin. Launch the Companion from the desktop or Start menu after installation.

Includes the CB relay fix: blank main relay addresses are repaired, and Settings → CB & relay backup has Main relay URL and Share with convoy controls. Confirm the address, enable sharing if desired, then supply your convoy code and any required relay key under Convoy → Join a convoy.

Close the Companion and ATS before installing. Native installer upgrades preserve configuration and data. For script installer users, settings and data are copied from `%LOCALAPPDATA%\KAW-ATS-Companion` if the native installation has no existing config. Remove the old script installer's startup shortcut to avoid starting two copies.

The Windows build passed the Companion test suite and installed-app smoke checks with system Node.js, npm and Python removed from PATH. Checks verify the private runtime, prebuilt native module, dashboard, CB settings controls, preservation of native settings/data, and migration of script-installer settings/data and relay keys.

Actual ATS game telemetry and the hosted relay were not tested on the runner. Online CB needs a running relay and any required key. This installer is not code signed.

Verify the executable against the attached SHA-256 checksum. Build provenance is attached as `build-manifest.json`.

[Source changes](https://github.com/devkawteam/kaws-ats-playground/pull/9).
