# Build the self-contained Windows installer

Run `installer/build-windows.ps1` on a clean Windows x64 build machine with
Python 3, Visual Studio C++ Build Tools, Git and Inno Setup 6. These tools are
build prerequisites only; drivers do not install them.

The script verifies the official v1.6.1 native installer against its pinned
SHA-256 and retains only its launcher, icon and telemetry plugin. It downloads
Node.js 22.23.3 from nodejs.org and verifies the official archive checksum.
It installs the locked Companion dependency on Windows using that same Node
runtime, loads the native module, runs the standalone Companion tests listed in `windows-tests.txt`, and compiles the
Inno Setup installer. No local config, keys, trip data or logs are packaged.
`dist` contains Setup.exe, its checksum and a build provenance manifest.

Run `installer/test-native-installer.ps1 -Setup <Setup.exe> -TestRoot <empty-folder>`
only on a clean disposable Windows runner. It installs the actual executable,
removes system development tools from PATH, checks the private runtime and
native module, starts the installed launcher, and validates the dashboard and
CB settings. It also checks native updates preserve config/data and migration
from the script installer preserves data, keys and sharing preferences.
The smoke test creates a simulated legacy installation under LOCALAPPDATA and
refuses to run if an existing one is present.

The downloads repository's Windows installer workflow builds this source at an
exact commit, runs these checks, then attaches the tested executable and
checksum to the GitHub release. Live ATS telemetry requires ATS on a driver
PC and is not covered by the runner. The executable is not code signed.

The complete source-repository suite also includes bot, knowledge service and relay
tests. Those components are not shipped or exported in this build context. Run
`npm test` in the complete source checkout for cross-component coverage.
