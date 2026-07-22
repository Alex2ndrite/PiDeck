#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const FIXTURE_VERSION = 1;
const FIXED_SEED = "pideck-session-first-v1";
const FIXED_TIME = "2026-01-15T08:00:00.000Z";
const DEFAULT_LARGE_BYTES = 50 * 1024 * 1024;
const MARKER = ".pideck-session-fixtures.json";
const MANAGED_ENTRIES = ["sessions", "user-data", "project", "fixture-manifest.json", MARKER];

function normalizeSlashes(value) {
	return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

function pathIsWithin(candidate, root) {
	const rel = relative(resolve(root), resolve(candidate));
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function deterministicId(label) {
	return createHash("sha256").update(`${FIXED_SEED}:${label}`).digest("hex").slice(0, 24);
}

function stableTimestamp(index) {
	return new Date(Date.parse(FIXED_TIME) + index * 1_000).toISOString();
}

function sessionHeader(label, cwd) {
	return {
		type: "session",
		version: 3,
		id: deterministicId(`${label}:session`),
		timestamp: FIXED_TIME,
		cwd,
	};
}

function messageEntry(label, index, parentId, text) {
	const id = deterministicId(`${label}:message:${index}`);
	return {
		type: "message",
		id,
		parentId,
		timestamp: stableTimestamp(index + 1),
		message: {
			role: index % 2 === 0 ? "user" : "assistant",
			content: [{ type: "text", text }],
		},
	};
}

export function createSessionJsonl({ label, messageCount, cwd, textSize = 96 }) {
	const header = sessionHeader(label, cwd);
	const lines = [JSON.stringify(header)];
	let parentId = header.id;
	for (let index = 0; index < messageCount; index += 1) {
		const prefix = `${label} deterministic message ${String(index + 1).padStart(5, "0")} `;
		const text = (prefix + "0123456789abcdef".repeat(Math.ceil(textSize / 16))).slice(0, textSize);
		const entry = messageEntry(label, index, parentId, text);
		lines.push(JSON.stringify(entry));
		parentId = entry.id;
	}
	return `${lines.join("\n")}\n`;
}

export function createSizedSessionJsonl({ label, targetBytes = DEFAULT_LARGE_BYTES, cwd }) {
	if (!Number.isSafeInteger(targetBytes) || targetBytes < 4_096) {
		throw new Error("targetBytes must be an integer of at least 4096 bytes");
	}
	const header = sessionHeader(label, cwd);
	const lines = [JSON.stringify(header)];
	let bytes = Buffer.byteLength(`${lines[0]}\n`);
	let parentId = header.id;
	let index = 0;
	const chunkText = "0123456789abcdef".repeat(4_096);
	while (true) {
		const entry = messageEntry(label, index, parentId, chunkText);
		const line = JSON.stringify(entry);
		const lineBytes = Buffer.byteLength(`${line}\n`);
		if (bytes + lineBytes + 512 > targetBytes) break;
		lines.push(line);
		bytes += lineBytes;
		parentId = entry.id;
		index += 1;
	}
	const emptyEntry = messageEntry(label, index, parentId, "");
	const emptyLineBytes = Buffer.byteLength(`${JSON.stringify(emptyEntry)}\n`);
	const remainingTextBytes = targetBytes - bytes - emptyLineBytes;
	if (remainingTextBytes < 0) throw new Error(`Unable to fit final entry into ${targetBytes} bytes`);
	lines.push(JSON.stringify(messageEntry(label, index, parentId, "x".repeat(remainingTextBytes))));
	const content = `${lines.join("\n")}\n`;
	if (Buffer.byteLength(content) !== targetBytes) throw new Error("Sized JSONL byte count mismatch");
	return content;
}

export function shellQuote(value) {
	return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export function buildWslArgs({ distro, user, script }) {
	if (!distro || !user || !script) throw new Error("distro, user, and script are required");
	return ["-d", distro, "-u", user, "--", "sh", "-lc", script];
}

export function isAllowedWslFixtureDir(directory, home) {
	const normalizedHome = normalizeSlashes(home);
	const normalizedDir = normalizeSlashes(directory);
	if (!normalizedHome.startsWith("/") || normalizedHome.startsWith("/mnt/")) return false;
	return normalizedDir.startsWith(`${normalizedHome}/.pi/agent/sessions/`) &&
		/^pideck-validation-[a-f0-9]{7,64}$/.test(normalizedDir.split("/").at(-1) ?? "");
}

export function assertSafeOutputDir(outputDir, options = {}) {
	if (!outputDir || !isAbsolute(outputDir)) throw new Error("--output must be an explicit absolute path");
	const output = resolve(outputDir);
	const home = resolve(options.homeDir ?? homedir());
	if (output === home) throw new Error(`Refusing to use the real home directory: ${output}`);
	const forbiddenRoots = [
		options.appDataDir ?? process.env.APPDATA,
		options.localAppDataDir ?? process.env.LOCALAPPDATA,
		...(options.forbiddenRoots ?? []),
	].filter(Boolean);
	for (const root of forbiddenRoots) {
		if (pathIsWithin(output, root)) throw new Error(`Refusing to use a real userData location: ${output}`);
	}
	if (resolve(output, "..") === output) throw new Error(`Refusing to use filesystem root: ${output}`);
	return output;
}

export async function prepareOutputDirectory(outputDir) {
	await mkdir(outputDir, { recursive: true });
	const entries = await readdir(outputDir);
	if (entries.length > 0 && !entries.includes(MARKER)) {
		throw new Error(`Refusing to clean unmarked output directory: ${outputDir}`);
	}
	if (entries.includes(MARKER)) {
		const marker = JSON.parse(await readFile(join(outputDir, MARKER), "utf8"));
		if (marker.version !== FIXTURE_VERSION || resolve(marker.outputDir) !== resolve(outputDir)) {
			throw new Error(`Fixture marker does not own output directory: ${outputDir}`);
		}
		for (const entry of MANAGED_ENTRIES) await rm(join(outputDir, entry), { recursive: true, force: true });
	}
	await mkdir(outputDir, { recursive: true });
}

async function defaultWslRunner(command, args, options = {}) {
	return execFile(command, args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, ...options });
}

function originKey({ source, environment, filePath, distro, user, importedSourceId }) {
	const environmentKey = environment === "wsl" ? `wsl:${distro}:${user}` : "native";
	const canonicalPath = environment === "native"
		? normalizeSlashes(filePath).toLowerCase()
		: normalizeSlashes(filePath);
	return `${source}:${environmentKey}:${canonicalPath}${importedSourceId ? `:${encodeURIComponent(importedSourceId)}` : ""}`;
}

async function probeWsl({ distro, user, expectedHome, runner }) {
	const script = "set -eu; command -v pi >/dev/null; printf '%s\\n%s\\n' \"$HOME\" \"$(whoami)\"";
	const result = await runner("wsl.exe", buildWslArgs({ distro, user, script }));
	const [home, actualUser] = String(result.stdout ?? "").trim().split(/\r?\n/);
	if (!home?.startsWith("/") || home.startsWith("/mnt/")) {
		throw new Error(`WSL HOME is not an ext4 POSIX home: ${home || "<empty>"}`);
	}
	if (actualUser !== user) throw new Error(`WSL user mismatch: expected ${user}, got ${actualUser}`);
	if (expectedHome && normalizeSlashes(expectedHome) !== normalizeSlashes(home)) {
		throw new Error(`WSL root mismatch: expected ${expectedHome}, got ${home}`);
	}
	return normalizeSlashes(home);
}

async function writeWslIdentityFixtures({ distro, user, home, sha, upper, lower, runner }) {
	const directory = `${home}/.pi/agent/sessions/pideck-validation-${sha}`;
	if (!isAllowedWslFixtureDir(directory, home)) throw new Error(`Refusing unsafe WSL fixture directory: ${directory}`);
	const resetScript = `set -eu; target=${shellQuote(directory)}; rm -rf -- \"$target\"; mkdir -p -- \"$target\"`;
	await runner("wsl.exe", buildWslArgs({ distro, user, script: resetScript }));
	for (const [name, content] of [["Case.jsonl", upper], ["case.jsonl", lower]]) {
		const filePath = `${directory}/${name}`;
		const script = `set -eu; printf %s ${shellQuote(content)} > ${shellQuote(filePath)}`;
		await runner("wsl.exe", buildWslArgs({ distro, user, script }));
	}
	return directory;
}

function parseArgs(argv) {
	const options = {};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--dry-run") options.dryRun = true;
		else if (["--output", "--sha", "--wsl-distro", "--wsl-user", "--wsl-root"].includes(arg)) {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
			options[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
			index += 1;
		} else if (arg === "--help") options.help = true;
		else throw new Error(`Unknown argument: ${arg}`);
	}
	return options;
}

export async function generateSessionFixtures({
	outputDir,
	sha,
	wslDistro,
	wslUser,
	wslRoot,
	dryRun = false,
	largeTargetBytes = DEFAULT_LARGE_BYTES,
	runner = defaultWslRunner,
	safety = {},
}) {
	const output = assertSafeOutputDir(outputDir, safety);
	if (!/^[a-f0-9]{7,64}$/i.test(sha ?? "")) throw new Error("--sha must be a 7-64 character hex commit SHA");
	const normalizedSha = sha.toLowerCase();
	const wslRequested = Boolean(wslDistro || wslUser || wslRoot);
	if (wslRequested && (!wslDistro || !wslUser)) {
		throw new Error("--wsl-distro and --wsl-user must be provided together");
	}
	if (wslRoot && (!wslRoot.startsWith("/") || wslRoot.startsWith("/mnt/"))) {
		throw new Error("--wsl-root must be an ext4 POSIX home path, not /mnt/*");
	}
	const projectCwd = join(output, "project");
	const nativeIdentityDir = join(output, "sessions", "identity", "native");
	const nativeUpperPath = join(nativeIdentityDir, "Case.jsonl");
	const nativeLowerPath = join(nativeIdentityDir, "case.jsonl");
	const plannedWslDir = wslRoot
		? `${normalizeSlashes(wslRoot)}/.pi/agent/sessions/pideck-validation-${normalizedSha}`
		: undefined;
	if (dryRun) {
		return {
			dryRun: true,
			outputDir: output,
			managedEntries: [...MANAGED_ENTRIES],
			wsl: wslRequested ? {
				distro: wslDistro,
				user: wslUser,
				home: wslRoot ?? "<detected-$HOME>",
				directory: plannedWslDir ?? "<detected-$HOME>/.pi/agent/sessions/pideck-validation-<sha>",
			} : null,
		};
	}

	await prepareOutputDirectory(output);
	await Promise.all([
		mkdir(join(output, "sessions", "scale"), { recursive: true }),
		mkdir(nativeIdentityDir, { recursive: true }),
		mkdir(join(output, "sessions", "imports"), { recursive: true }),
		mkdir(join(output, "user-data"), { recursive: true }),
		mkdir(projectCwd, { recursive: true }),
	]);
	const scaleFiles = {};
	for (const count of [100, 1_000, 10_000]) {
		const key = String(count);
		const filePath = join(output, "sessions", "scale", `messages-${key}.jsonl`);
		await writeFile(filePath, createSessionJsonl({
			label: `messages-${key}`,
			messageCount: count,
			cwd: projectCwd,
		}), "utf8");
		scaleFiles[key] = filePath;
	}
	const largeFile = join(output, "sessions", "scale", "messages-50mb.jsonl");
	await writeFile(largeFile, createSizedSessionJsonl({
		label: "messages-50mb",
		targetBytes: largeTargetBytes,
		cwd: projectCwd,
	}), "utf8");

	const upperContent = createSessionJsonl({ label: "identity-upper", messageCount: 2, cwd: projectCwd });
	const lowerContent = createSessionJsonl({ label: "identity-lower", messageCount: 2, cwd: projectCwd });
	// On case-insensitive native filesystems these names identify one file. Sequential writes keep regeneration deterministic.
	await writeFile(nativeUpperPath, upperContent, "utf8");
	await writeFile(nativeLowerPath, lowerContent, "utf8");
	const importedSourceId = "codex-thread-validation-001";
	const importedPath = join(output, "sessions", "imports", "codex-native.jsonl");
	const importedBody = createSessionJsonl({ label: "codex-native", messageCount: 4, cwd: projectCwd });
	const importMarker = JSON.stringify({
		type: "codex_import",
		codexSessionId: importedSourceId,
		sourcePath: join(output, "source", "codex-thread.jsonl"),
		threadSource: "user",
	});
	await writeFile(importedPath, `${importMarker}\n${importedBody}`, "utf8");

	let wslHome;
	let wslDirectory;
	if (wslRequested) {
		wslHome = await probeWsl({ distro: wslDistro, user: wslUser, expectedHome: wslRoot, runner });
		wslDirectory = await writeWslIdentityFixtures({
			distro: wslDistro,
			user: wslUser,
			home: wslHome,
			sha: normalizedSha,
			upper: upperContent,
			lower: lowerContent,
			runner,
		});
	}

	const nativeOrigin = originKey({ source: "pi", environment: "native", filePath: nativeUpperPath });
	const importedOrigin = originKey({
		source: "codex",
		environment: "native",
		filePath: importedPath,
		importedSourceId,
	});
	const catalogEntries = [
		{
			id: "fixture-native-case-folded",
			projectId: "fixture-project-native",
			originKey: nativeOrigin,
			title: "Native case identity",
			source: "pi",
			environment: "native",
			filePath: nativeUpperPath,
			status: "active",
			createdAt: Date.parse(FIXED_TIME),
			updatedAt: Date.parse(FIXED_TIME),
		},
		{
			id: "fixture-codex-import",
			projectId: "fixture-project-native",
			originKey: importedOrigin,
			title: "Imported source identity",
			source: "codex",
			environment: "native",
			filePath: importedPath,
			importedSourceId,
			status: "active",
			createdAt: Date.parse(FIXED_TIME),
			updatedAt: Date.parse(FIXED_TIME),
		},
	];
	if (wslDirectory) {
		for (const name of ["Case.jsonl", "case.jsonl"]) {
			const filePath = `${wslDirectory}/${name}`;
			catalogEntries.push({
				id: `fixture-wsl-${name.startsWith("C") ? "upper" : "lower"}`,
				projectId: "fixture-project-wsl",
				originKey: originKey({ source: "pi", environment: "wsl", filePath, distro: wslDistro, user: wslUser }),
				title: `WSL ${name}`,
				source: "pi",
				environment: "wsl",
				filePath,
				wslDistro,
				wslUser,
				status: "active",
				createdAt: Date.parse(FIXED_TIME),
				updatedAt: Date.parse(FIXED_TIME),
			});
		}
	}
	const catalog = { version: 1, sessions: catalogEntries };
	const userDataDir = join(output, "user-data");
	const catalogPath = join(userDataDir, "session-catalog.json");
	const catalogBackupPath = `${catalogPath}.bak`;
	const corruptCatalogPath = join(userDataDir, "session-catalog.corrupt.json");
	const settingsPath = join(userDataDir, "settings.json");
	const projectsPath = join(userDataDir, "projects.json");
	await Promise.all([
		writeFile(catalogPath, JSON.stringify(catalog, null, 2), "utf8"),
		writeFile(catalogBackupPath, JSON.stringify(catalog, null, 2), "utf8"),
		writeFile(corruptCatalogPath, '{"version":1,"sessions":[', "utf8"),
		writeFile(settingsPath, JSON.stringify({
			language: "en",
			wslEnabled: Boolean(wslDirectory),
			wslDistro: wslDistro ?? "Ubuntu",
			wslUser: wslUser ?? "root",
			telemetryEnabled: false,
			showDevTools: false,
		}, null, 2), "utf8"),
		writeFile(projectsPath, JSON.stringify([
			{
				id: "fixture-project-native",
				name: "PiDeck validation native",
				path: projectCwd,
				lastOpenedAt: Date.parse(FIXED_TIME),
				sortOrder: 0,
				environment: "windows",
			},
			...(wslDirectory ? [{
				id: "fixture-project-wsl",
				name: "PiDeck validation WSL",
				path: wslDirectory,
				lastOpenedAt: Date.parse(FIXED_TIME),
				sortOrder: 1,
				environment: "wsl",
			}] : []),
		], null, 2), "utf8"),
	]);

	const largeStats = await stat(largeFile);
	const wslPaths = wslDirectory ? [`${wslDirectory}/Case.jsonl`, `${wslDirectory}/case.jsonl`] : [];
	const manifest = {
		version: FIXTURE_VERSION,
		seed: FIXED_SEED,
		sha: normalizedSha,
		generatedAt: FIXED_TIME,
		outputDir: output,
		projectCwd,
		scale: {
			messages: Object.fromEntries(Object.entries(scaleFiles).map(([count, filePath]) => [count, {
				path: filePath,
				messageCount: Number(count),
			}])),
			large: { path: largeFile, bytes: largeStats.size, targetBytes: largeTargetBytes },
		},
		catalog: { primary: catalogPath, backup: catalogBackupPath, corrupt: corruptCatalogPath },
		userData: { directory: userDataDir, settings: settingsPath, projects: projectsPath },
		nativeIdentity: {
			paths: [nativeUpperPath, nativeLowerPath],
			source: "pi",
			importedSourceId: null,
			expectedOriginKeys: [nativeOrigin, nativeOrigin],
			expectedIndependentSessionCount: 1,
		},
		importIdentity: {
			path: importedPath,
			source: "codex",
			importedSourceId,
			expectedOriginKey: importedOrigin,
			expectedIndependentSessionCount: 1,
		},
		wslIdentity: wslDirectory ? {
			distro: wslDistro,
			user: wslUser,
			home: wslHome,
			directory: wslDirectory,
			paths: wslPaths,
			source: "pi",
			importedSourceId: null,
			expectedOriginKeys: wslPaths.map((filePath) => originKey({
				source: "pi",
				environment: "wsl",
				filePath,
				distro: wslDistro,
				user: wslUser,
			})),
			expectedIndependentSessionCount: 2,
		} : null,
	};
	const fixtureManifestPath = join(output, "fixture-manifest.json");
	await writeFile(fixtureManifestPath, JSON.stringify(manifest, null, 2), "utf8");
	await writeFile(join(output, MARKER), JSON.stringify({
		version: FIXTURE_VERSION,
		outputDir: output,
		sha: normalizedSha,
	}, null, 2), "utf8");
	return { ...manifest, fixtureManifestPath };
}

function helpText() {
	return [
		"Usage: node scripts/generate-session-fixtures.mjs --output <absolute-dir> --sha <commit> [options]",
		"",
		"Options:",
		"  --wsl-distro <name>  Target distro (requires --wsl-user)",
		"  --wsl-user <name>    Target WSL user (requires --wsl-distro)",
		"  --wsl-root <path>    Expected ext4 $HOME; rejects /mnt/*",
		"  --dry-run            Print the bounded write plan without changing files",
	].join("\n");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
	try {
		const options = parseArgs(process.argv.slice(2));
		if (options.help) console.log(helpText());
		else {
			if (!options.output || !options.sha) throw new Error("--output and --sha are required");
			const result = await generateSessionFixtures({
				outputDir: options.output,
				sha: options.sha,
				wslDistro: options.wslDistro,
				wslUser: options.wslUser,
				wslRoot: options.wslRoot,
				dryRun: options.dryRun,
			});
			console.log(JSON.stringify(result, null, 2));
		}
	} catch (error) {
		console.error(`Fixture generation failed: ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	}
}
