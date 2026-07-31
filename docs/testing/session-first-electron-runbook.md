# Session-first Electron validation runbook

This runbook validates one immutable commit at a time. Every command derives the commit from `git rev-parse HEAD`; do not paste a stale SHA. Native evidence stays below `F:\PiDeck-validation\<sha>\`, and WSL fixtures stay below the exact ext4 path recorded by the manifest.

Never point PiDeck at normal Electron userData. Never copy fixtures into `%APPDATA%`, `%LOCALAPPDATA%`, or a real WSL home outside the manifest target.

## Current execution status

The following execution evidence is intentionally outstanding for this A11 follow-up:

- GUI scenarios A3-A8: **NOT RUN**.
- WSL preflight, fixture generation, and GUI scenario A9: **NOT RUN**.
- Performance comparison and paired baseline: **NOT RUN**.

The commands and assertions below are the runbook for a future controlled execution. A test pass for the generator or verifier does not claim that these interactive scenarios ran.

## 1. Generate and validate fixtures

Run from the repository root in PowerShell:

```powershell
$Sha = (git rev-parse HEAD).Trim()
if ($Sha -notmatch '^[0-9a-f]{40}$') { throw "HEAD is not a full commit SHA: $Sha" }
$Evidence = "F:\PiDeck-validation\$Sha"
$Fixtures = Join-Path $Evidence "fixtures"
New-Item -ItemType Directory -Force $Evidence | Out-Null
git status --short | Tee-Object (Join-Path $Evidence "git-status-before.txt")
git rev-parse HEAD | Tee-Object (Join-Path $Evidence "commit.txt")

npm run build 2>&1 | Tee-Object (Join-Path $Evidence "build.log")
node scripts/verify-build-artifacts.mjs --repo-root (Get-Location).Path --json 2>&1 | Tee-Object (Join-Path $Evidence "build-artifacts.json")
node scripts/generate-session-fixtures.mjs --output $Fixtures --sha $Sha 2>&1 | Tee-Object (Join-Path $Evidence "fixture-generation.log")

$ManifestPath = Join-Path $Fixtures "fixture-manifest.json"
$Manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
if ($Manifest.sha -ne $Sha) { throw "Fixture SHA $($Manifest.sha) does not match current HEAD $Sha" }
if ($Manifest.outputDir -ne (Resolve-Path $Fixtures).Path) { throw "Fixture output path mismatch" }
if (-not $Manifest.userData.native) { throw "Native user-data template missing" }
if ($Manifest.userData.wsl) { throw "WSL template must be generated only after WSL preflight" }
```

The native template is `$Manifest.userData.native`. It contains `settings`, `projects`, and `catalog.primary`, `catalog.backup`, and `catalog.corrupt`. The scale paths are `$Manifest.scale.messages.'100'.path`, `$Manifest.scale.messages.'1000'.path`, `$Manifest.scale.messages.'10000'.path`, and `$Manifest.scale.large.path`. Treat these manifest paths, source/import identity fields, stat metadata, project cwd, expected origin keys, and expected independent Session counts as assertions.

## 2. Isolated scenario protocol

Use a new run directory, userData directory, and remote-debugging port for each scenario. Do not reuse an Electron process or userData directory.

1. Stop only the PiDeck process started for this scenario.
2. Create `$Run` below `$Evidence\runs\<scenario>` and copy the manifest there.
3. Select the template through `$Manifest.scenarios.<scenario>.userDataTemplate`, then copy that template's `settings`, `projects`, and selected catalog files into `$UserData`. Preserve byte-for-byte copies under `$Run\injected-user-data`.
4. Start with exactly `npm run dev -- -- --user-data-dir=<isolated-dir> --remote-debugging-port=<port>`, recording the expanded command and output.
5. Record desktop Session ID, runtime agent ID, Pi session ID, source/import ID, origin key, project cwd, environment, distro/user, session path, and port in `ids.json`. Values must come from the manifest and the application output, not hand-written expectations.
6. Capture screenshots, recording, console/RPC logs, trace, CPU profile, and heap snapshot when the scenario is actually executed.
7. Close normally, save final catalog/userData, then delete only the current scenario directory and its isolated userData. WSL cleanup is limited to the exact manifest directory.

Example template injection, using the native template selected by the manifest:

```powershell
$Scenario = "A3"
$Run = Join-Path $Evidence "runs\$Scenario"
$UserData = Join-Path $Run "user-data"
$TemplateName = $Manifest.scenarios.$Scenario.userDataTemplate
$Template = $Manifest.userData.$TemplateName
New-Item -ItemType Directory -Force $Run, $UserData, (Join-Path $Run "injected-user-data") | Out-Null
Copy-Item $ManifestPath (Join-Path $Run "fixture-manifest.json")
Copy-Item $Template.settings, $Template.projects, $Template.catalog.primary, $Template.catalog.backup -Destination $UserData
Copy-Item $Template.settings, $Template.projects, $Template.catalog.primary, $Template.catalog.backup -Destination (Join-Path $Run "injected-user-data")
$Port = 9333
npm run dev -- -- --user-data-dir=$UserData --remote-debugging-port=$Port 2>&1 | Tee-Object (Join-Path $Run "electron.log")
```

## 3. Scenario matrix

| ID | Manifest-selected fixture/action | Required result | Execution state |
| --- | --- | --- | --- |
| A1 | Build and `verify-build-artifacts` | Four Electron entry points, regular nonempty HTML resources, and freshness pass | Run by CI or operator |
| A2 | New empty output outside the repository | Non-zero exit and all four entry classes reported missing | Run by CI or operator |
| A3 | `$Manifest.scenarios.A3.sessionPath` | 100 messages, stable ordering, one desktop Session | NOT RUN |
| A4 | `$Manifest.scenarios.A4.sessionPath` | 1,000 messages; selection and scroll remain correct | NOT RUN |
| A5 | `$Manifest.scenarios.A5.sessionPath` | 10,000 messages; no duplicate runtime or desktop Session | NOT RUN |
| A6 | `$Manifest.scenarios.A6.sessionPath` | Disk byte size equals `$Manifest.scale.large.bytes`; visible completion/failure and valid catalog | NOT RUN |
| A7 | Replace native primary with `$Manifest.userData.native.catalog.corrupt`, retain `.bak` | Backup recovery restores expected entries and rewrites valid primary; use current `$Sha` manifest | NOT RUN |
| A8 | `$Manifest.scenarios.A8.sessionPaths` | Native case paths collapse to one independent Session while Codex import remains independent | NOT RUN |
| A9 | `$Manifest.scenarios.A9.sessionPaths` after WSL generation | Case-sensitive POSIX paths remain two independent Sessions with exact distro/user | NOT RUN |
| A10 | Dry-run with current `$Sha` | No native/WSL writes; plan names only requested output and exact validation directory | NOT RUN |

A2 must not touch the real build output:

```powershell
$EmptyOut = Join-Path $Evidence "empty-out"
New-Item -ItemType Directory -Force $EmptyOut | Out-Null
node scripts/verify-build-artifacts.mjs --repo-root (Get-Location).Path --out $EmptyOut --json
if ($LASTEXITCODE -eq 0) { throw "A2 expected verifier failure" }
```

A7 must use the native template and the current manifest for this run. Do not use a copied or hardcoded SHA:

```powershell
$Native = $Manifest.userData.native
Copy-Item $Native.catalog.corrupt (Join-Path $UserData "session-catalog.json") -Force
Copy-Item $Native.catalog.backup (Join-Path $UserData "session-catalog.json.bak") -Force
Copy-Item $ManifestPath (Join-Path $Run "fixture-manifest.json") -Force
if ((Get-Content (Join-Path $Run "fixture-manifest.json") -Raw | ConvertFrom-Json).sha -ne $Sha) { throw "A7 manifest SHA mismatch" }
```

## 4. WSL preflight and generation

WSL generation is **NOT RUN** in the current follow-up. When it is authorized, all preflight output must be saved before generation:

```powershell
$Distro = "Ubuntu"
$WslUser = "dev"
wsl.exe --list --verbose | Tee-Object (Join-Path $Evidence "wsl-list.txt")
wsl.exe -d $Distro -u $WslUser -- whoami | Tee-Object (Join-Path $Evidence "wsl-whoami.txt")
wsl.exe -d $Distro -u $WslUser -- sh -lc 'command -v pi && pi --version && printf "HOME=%s\n" "$HOME"' | Tee-Object (Join-Path $Evidence "wsl-probe.txt")
```

Set `$WslRoot` to the exact canonical `HOME` printed by the probe. It must be a realpath under an ext4 filesystem, not `/mnt/*`, and the requested user must equal `whoami`:

```powershell
$WslRoot = "/home/dev" # replace only with the exact validated probe result
node scripts/generate-session-fixtures.mjs --output $Fixtures --sha $Sha --wsl-distro $Distro --wsl-user $WslUser --wsl-root $WslRoot 2>&1 | Tee-Object (Join-Path $Evidence "wsl-fixture-generation.log")
$Manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
if ($Manifest.sha -ne $Sha) { throw "WSL fixture SHA mismatch" }
if (-not $Manifest.userData.wsl) { throw "WSL template missing after WSL generation" }
if ($Manifest.wslIdentity.projectCwd -ne "$($Manifest.wslIdentity.directory)/project") { throw "WSL project cwd is outside validation tree" }
```

The generator invokes `wsl.exe` with argument arrays: `-d <distro> -u <user> -- sh -lc <script>`. The reset script independently canonicalizes `$HOME`, checks `findmnt` is `ext4`, checks the exact `$HOME/.pi/agent/sessions/pideck-validation-<sha>` realpath, and removes only that exact target. Never simulate WSL case behavior with two files on NTFS.

## 5. Evidence layout

Each executed scenario must contain:

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

Use `NOT RUN.txt` for a capture category only when the scenario was not executed and the reason is recorded in `notes.md`. Do not create placeholder success evidence.

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

## 6. Performance rule

Performance comparison is **NOT RUN** for this follow-up. A valid comparison requires a paired baseline and candidate from the same machine, fixed-seed manifest, Electron/Node versions, userData template, port conditions, capture settings, and scenario procedure. Do not call an unpaired trace/profile/heap an improvement or regression.

## 7. A10 dry run

A10 must use the current commit SHA and must not assume a prior fixed SHA. The manifest is parsed and checked before running it:

```powershell
$Manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
$Sha = (git rev-parse HEAD).Trim()
if ($Manifest.sha -ne $Sha) { throw "A10 manifest SHA mismatch: $($Manifest.sha) vs $Sha" }
$WslArgs = @()
if ($Manifest.wslIdentity) {
  $WslArgs = @("--wsl-distro", $Manifest.wslIdentity.distro, "--wsl-user", $Manifest.wslIdentity.user, "--wsl-root", $Manifest.wslIdentity.home)
}
$Before = (Get-ChildItem -Force -Recurse $Fixtures | Select-Object FullName, Length, LastWriteTimeUtc | ConvertTo-Json -Depth 4)
node scripts/generate-session-fixtures.mjs --output $Fixtures --sha $Sha @WslArgs --dry-run | Tee-Object (Join-Path $Evidence "a10-dry-run.json")
$After = (Get-ChildItem -Force -Recurse $Fixtures | Select-Object FullName, Length, LastWriteTimeUtc | ConvertTo-Json -Depth 4)
if ($Before -ne $After) { throw "A10 changed fixture files" }
```

The dry-run JSON may name only the requested native output and, when WSL arguments were supplied from the manifest, `$Manifest.wslIdentity.directory`. The current `$Sha` must appear in the planned validation directory; no other WSL path is permitted.
