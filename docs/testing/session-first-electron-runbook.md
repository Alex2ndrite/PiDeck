# Session-first Electron validation runbook

This runbook validates one immutable commit at a time. Replace `<sha>` only with the full commit under test. All native evidence and generated data for that commit stays below:

```text
F:\PiDeck-validation\<sha>\
```

Never point PiDeck at the normal Electron userData directory. Never copy fixtures into a real `%APPDATA%` or `%LOCALAPPDATA%` application directory.

## 1. One-time setup

From the repository root, record the commit and create the evidence root:

```powershell
$Sha = (git rev-parse HEAD).Trim()
$Evidence = "F:\PiDeck-validation\$Sha"
$Fixtures = "$Evidence\fixtures"
$NativeUserData = "$Evidence\user-data-native"
$WslUserData = "$Evidence\user-data-wsl"
New-Item -ItemType Directory -Force $Evidence | Out-Null
git status --short | Tee-Object "$Evidence\git-status-before.txt"
git rev-parse HEAD | Tee-Object "$Evidence\commit.txt"
```

Build and verify artifacts before launching Electron:

```powershell
npm run build 2>&1 | Tee-Object "$Evidence\build.log"
node scripts/verify-build-artifacts.mjs --repo-root (Get-Location).Path --json 2>&1 | Tee-Object "$Evidence\build-artifacts.json"
```

Generate native fixtures. Add the WSL flags from section 4 only after WSL preflight succeeds.

```powershell
node scripts/generate-session-fixtures.mjs --output $Fixtures --sha $Sha 2>&1 | Tee-Object "$Evidence\fixture-generation.log"
```

Copy `fixture-manifest.json` to each scenario evidence directory before a run. Treat the fixture manifest's absolute paths, source/import identity, project cwd, expected origin keys, and expected independent Session counts as the assertions, not as suggestions.

## 2. Per-scenario protocol

Use these steps for every interactive scenario A3-A9. Do not reuse a running Electron process or userData directory across scenarios.

1. **Reset:** Stop only the PiDeck process started for the current scenario. Remove only that scenario's directory below `F:\PiDeck-validation\<sha>\runs\<scenario>\` and its isolated userData directory. Do not remove the commit evidence root, another scenario, a normal userData directory, or any WSL path outside the manifest's `pideck-validation-<sha>` directory.
2. **Inject:** Create the scenario userData directory, then copy the fixture `settings.json`, `projects.json`, selected `session-catalog.json`, and its `.bak` into it. Keep a byte-for-byte copy of the injected files under the scenario evidence directory.
3. **Start:** Use a unique remote-debugging port. The native launch command is exactly `npm run dev -- -- --user-data-dir=<isolated-dir> --remote-debugging-port=<port>`. Record the expanded command and stdout/stderr.
4. **Identify:** Record the desktop Session ID, runtime agent ID, Pi session ID, source/import ID, origin key, project cwd, environment, distro/user where applicable, selected JSONL path, and remote-debugging port in `ids.json`.
5. **Capture:** Save before/after screenshots, a screen recording for the full interaction, a DevTools Performance trace, a `.cpuprofile`, and a heap snapshot. Export console output and the relevant RPC/application logs.
6. **Close:** Close the tested Session and Electron normally. Record the final catalog and userData files before cleanup.
7. **Clean:** Delete only the current scenario's generated fixture directory and isolated userData after evidence is complete. WSL cleanup is limited to the exact manifest directory `$HOME/.pi/agent/sessions/pideck-validation-<sha>/`.

A minimal userData injection for a normal scenario is:

```powershell
$Scenario = "A3-native-100"
$Run = "$Evidence\runs\$Scenario"
$UserData = "$Run\user-data"
New-Item -ItemType Directory -Force $UserData | Out-Null
Copy-Item "$Fixtures\fixture-manifest.json" "$Run\fixture-manifest.json"
Copy-Item "$Fixtures\user-data\settings.json" "$UserData\settings.json"
Copy-Item "$Fixtures\user-data\projects.json" "$UserData\projects.json"
Copy-Item "$Fixtures\user-data\session-catalog.json" "$UserData\session-catalog.json"
Copy-Item "$Fixtures\user-data\session-catalog.json.bak" "$UserData\session-catalog.json.bak"
$Port = 9333
npm run dev -- -- --user-data-dir=$UserData --remote-debugging-port=$Port 2>&1 | Tee-Object "$Run\electron.log"
```

## 3. Scenario matrix

| ID | Fixture/action | Required result | Additional evidence |
| --- | --- | --- | --- |
| A1 | Run `npm run build`, then the build verifier | main, preload, renderer `index.html`, renderer `pet.html`, all HTML resources, and freshness checks pass | `build.log`, `build-artifacts.json` |
| A2 | Point verifier at a newly created empty `out` directory | Non-zero exit; all four entry classes are reported missing | command, exit code, verifier output |
| A3 | Open `messages-100.jsonl` | 100 messages, stable ordering, one desktop Session | IDs and first/last message screenshots |
| A4 | Open `messages-1000.jsonl` | 1,000 messages; selection and scroll remain correct | trace, CPU profile, heap |
| A5 | Open `messages-10000.jsonl` | 10,000 messages; no duplicate runtime or desktop Session | trace, CPU profile, heap, recording |
| A6 | Open `messages-50mb.jsonl` | manifest byte size matches disk; load completes or fails visibly without corrupting catalog | file hash, trace, CPU profile, heap |
| A7 | Replace primary with `session-catalog.corrupt.json`, retain valid `.bak`, then start | backup recovery restores the expected entries and rewrites a valid primary | injected corrupt/backup and recovered primary |
| A8 | Scan native `Case.jsonl`, `case.jsonl`, and `codex-native.jsonl` | native case paths collapse to one independent Session; Codex source/import identity remains independent | all origin keys and desktop Session IDs |
| A9 | Scan WSL `Case.jsonl` and `case.jsonl` | two independent Sessions with exact distro/user and case-sensitive POSIX origin keys | preflight, WSL paths, origin keys, IDs |
| A10 | Run fixture generator with `--dry-run` | no output or WSL files change; printed plan is bounded to the requested native directory and one WSL validation directory | before/after directory listing and dry-run JSON |

For A2, use a directory outside the repository so the real `out` is untouched:

```powershell
$EmptyOut = "$Evidence\empty-out"
New-Item -ItemType Directory -Force $EmptyOut | Out-Null
node scripts/verify-build-artifacts.mjs --repo-root (Get-Location).Path --out $EmptyOut --json
if ($LASTEXITCODE -eq 0) { throw "A2 expected verifier failure" }
```

For A7, perform the replacement only inside that scenario's isolated userData:

```powershell
Copy-Item "$Fixtures\user-data\session-catalog.corrupt.json" "$UserData\session-catalog.json" -Force
Copy-Item "$Fixtures\user-data\session-catalog.json.bak" "$UserData\session-catalog.json.bak" -Force
```

## 4. WSL preflight and generation

Do not request WSL fixture generation until all three preflight commands succeed. Save their exact output under A9 evidence.

```powershell
$Distro = "Ubuntu"
$WslUser = "dev"
wsl.exe --list --verbose
wsl.exe -d $Distro -u $WslUser -- whoami
wsl.exe -d $Distro -u $WslUser -- sh -lc 'command -v pi && pi --version && printf "HOME=%s\n" "$HOME"'
```

Set `$WslRoot` to the exact ext4 `HOME` printed above. `/mnt/*` is invalid. Generate fixtures with an isolated Windows evidence directory and the validated WSL identity:

```powershell
$WslRoot = "/home/dev"
node scripts/generate-session-fixtures.mjs --output $Fixtures --sha $Sha --wsl-distro $Distro --wsl-user $WslUser --wsl-root $WslRoot 2>&1 | Tee-Object "$Evidence\wsl-fixture-generation.log"
```

The generator invokes `wsl.exe` with argument arrays in the form `wsl.exe -d <distro> -u <user> -- sh -lc <script>`. It may reset only the exact ext4 directory recorded by the manifest:

```text
$HOME/.pi/agent/sessions/pideck-validation-<sha>/
```

Start A9 with a dedicated Windows userData and port, using the same exact launch shape as native:

```text
npm run dev -- -- --user-data-dir=<isolated-dir> --remote-debugging-port=<port>
```

The injected settings select WSL; the Electron application itself is still launched from the Windows repository. Never simulate WSL case behavior with two files on NTFS.

## 5. Evidence layout

Each scenario directory must contain this minimum set, using `NOT RUN.txt` only where this runbook explicitly permits it:

```text
runs/<scenario>/
  fixture-manifest.json
  command.txt
  exit-code.txt
  ids.json
  injected-user-data/
  final-user-data/
  screenshots/
  video/
  trace/
  profiler/
  heap/
  logs/
  notes.md
```

`ids.json` must make identity comparison mechanical:

```json
{
  "desktopSessionId": "...",
  "runtimeAgentId": "...",
  "piSessionId": "...",
  "source": "pi",
  "importedSourceId": null,
  "originKey": "...",
  "projectCwd": "...",
  "environment": "native",
  "wslDistro": null,
  "wslUser": null,
  "sessionPath": "...",
  "remoteDebuggingPort": 9333
}
```

## 6. Performance result rule

A performance comparison is valid only when the baseline and candidate are collected on the same machine, from the same fixed-seed fixture, with the same Electron/Node versions, userData template, port conditions, capture settings, and scenario procedure. If that baseline does not exist, write `NOT RUN` in the performance result and retain the candidate trace/profile/heap as diagnostic evidence. Do not describe an unpaired measurement as an improvement or regression.

## 7. A10 dry run

This command is safe to run before any fixture generation. It performs no native or WSL writes:

```powershell
node scripts/generate-session-fixtures.mjs --output "F:\PiDeck-validation\724fe6b22020bb90e30393096f5ec2d4b42b64df\fixtures" --sha 724fe6b22020bb90e30393096f5ec2d4b42b64df --wsl-distro $Distro --wsl-user $WslUser --wsl-root $WslRoot --dry-run
```

Capture directory listings before and after. They must be identical. The JSON plan may name only the requested native output and `$WslRoot/.pi/agent/sessions/pideck-validation-724fe6b22020bb90e30393096f5ec2d4b42b64df/`.
