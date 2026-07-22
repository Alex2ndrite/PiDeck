import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";
import {
	assertSafeOutputDir,
	buildWslArgs,
	createSizedSessionJsonl,
	generateSessionFixtures,
	isAllowedWslFixtureDir,
	prepareOutputDirectory,
	shellQuote,
} from "../scripts/generate-session-fixtures.mjs";

const SHA = "724fe6b22020bb90e30393096f5ec2d4b42b64df";
const safety = { appDataDir: "F:/never-appdata", localAppDataDir: "F:/never-localappdata" };

function digest(value) {
	return createHash("sha256").update(value).digest("hex");
}

async function withTempDir(run) {
	const dir = await mkdtemp(join(tmpdir(), "pideck-fixtures-test-"));
	try {
		return await run(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test("fixture generation is deterministic across a bounded regeneration", async () => {
	await withTempDir(async (root) => {
		const outputDir = join(root, "evidence");
		await generateSessionFixtures({ outputDir, sha: SHA, largeTargetBytes: 32 * 1024, safety });
		const paths = [
			join(outputDir, "sessions", "scale", "messages-100.jsonl"),
			join(outputDir, "sessions", "scale", "messages-1000.jsonl"),
			join(outputDir, "sessions", "scale", "messages-10000.jsonl"),
			join(outputDir, "sessions", "scale", "messages-50mb.jsonl"),
			join(outputDir, "manifest.json"),
		];
		const first = await Promise.all(paths.map(async (path) => digest(await readFile(path))));
		await generateSessionFixtures({ outputDir, sha: SHA, largeTargetBytes: 32 * 1024, safety });
		const second = await Promise.all(paths.map(async (path) => digest(await readFile(path))));
		assert.deepEqual(second, first);
	});
});

test("the large JSONL fixture is exactly 50 MiB and remains valid line-delimited JSON", () => {
	const targetBytes = 50 * 1024 * 1024;
	const content = createSizedSessionJsonl({ label: "size-boundary", targetBytes, cwd: "F:/validation/project" });
	assert.equal(Buffer.byteLength(content), targetBytes);
	const lines = content.trimEnd().split("\n");
	assert.equal(JSON.parse(lines[0]).type, "session");
	assert.equal(JSON.parse(lines.at(-1)).type, "message");
});

test("manifest records absolute native paths, catalogs, templates, and identity expectations", async () => {
	await withTempDir(async (root) => {
		const outputDir = join(root, "evidence");
		const manifest = await generateSessionFixtures({
			outputDir,
			sha: SHA,
			largeTargetBytes: 16 * 1024,
			safety,
		});
		assert.equal(manifest.seed, "pideck-session-first-v1");
		assert.equal(manifest.nativeIdentity.expectedIndependentSessionCount, 1);
		assert.equal(new Set(manifest.nativeIdentity.expectedOriginKeys).size, 1);
		assert.equal(manifest.importIdentity.source, "codex");
		assert.match(manifest.importIdentity.expectedOriginKey, /codex-thread-validation-001$/);
		for (const path of [
			...manifest.nativeIdentity.paths,
			manifest.catalog.primary,
			manifest.catalog.backup,
			manifest.catalog.corrupt,
			manifest.userData.settings,
			manifest.userData.projects,
		]) assert.equal(isAbsolute(path), true, path);
		await Promise.all(manifest.nativeIdentity.paths.map((path) => stat(path)));
		assert.equal(JSON.parse(await readFile(manifest.catalog.primary, "utf8")).version, 1);
		await assert.rejects(async () => JSON.parse(await readFile(manifest.catalog.corrupt, "utf8")));
	});
});

test("WSL runner receives parameter arrays, quoted ext4 paths, and case-distinct identities", async () => {
	await withTempDir(async (root) => {
		const calls = [];
		const runner = async (command, args, options = {}) => {
			calls.push({ command, args, options });
			if (calls.length === 1) return { stdout: "/home/o'neil\no'neil\n" };
			return { stdout: "" };
		};
		const manifest = await generateSessionFixtures({
			outputDir: join(root, "evidence"),
			sha: SHA,
			wslDistro: "Ubuntu Test; echo unsafe",
			wslUser: "o'neil",
			wslRoot: "/home/o'neil",
			largeTargetBytes: 16 * 1024,
			runner,
			safety,
		});
		assert.equal(calls.length, 4);
		for (const call of calls) {
			assert.equal(call.command, "wsl.exe");
			assert.deepEqual(call.args.slice(0, 6), ["-d", "Ubuntu Test; echo unsafe", "-u", "o'neil", "--", "sh"]);
			assert.equal(call.args[6], "-lc");
		}
		assert.match(calls[1].args[7], /rm -rf --/);
		assert.match(calls[1].args[7], /'"'"'/);
		assert.equal(manifest.wslIdentity.expectedIndependentSessionCount, 2);
		assert.equal(new Set(manifest.wslIdentity.expectedOriginKeys).size, 2);
		assert.deepEqual(manifest.wslIdentity.paths, [
			`/home/o'neil/.pi/agent/sessions/pideck-validation-${SHA}/Case.jsonl`,
			`/home/o'neil/.pi/agent/sessions/pideck-validation-${SHA}/case.jsonl`,
		]);
		assert.match(calls[2].args[7], /printf %s/);
		assert.match(calls[3].args[7], /printf %s/);
		assert.match(calls[2].args[7], /identity-upper/);
		assert.match(calls[3].args[7], /identity-lower/);
	});
});

test("escaping and WSL invocation helpers keep shell text out of argument positions", () => {
	assert.equal(shellQuote("a'b"), `'a'"'"'b'`);
	assert.deepEqual(buildWslArgs({ distro: "Ubuntu;false", user: "dev user", script: "printf ok" }), [
		"-d", "Ubuntu;false", "-u", "dev user", "--", "sh", "-lc", "printf ok",
	]);
	assert.equal(isAllowedWslFixtureDir(`/home/dev/.pi/agent/sessions/pideck-validation-${SHA}`, "/home/dev"), true);
	assert.equal(isAllowedWslFixtureDir("/home/dev/.pi/agent/sessions/other", "/home/dev"), false);
	assert.equal(isAllowedWslFixtureDir(`/mnt/c/tmp/pideck-validation-${SHA}`, "/mnt/c/tmp"), false);
});

test("cleanup refuses unmarked and real userData paths and never removes unrelated marked content", async () => {
	await withTempDir(async (root) => {
		const unmarked = join(root, "unmarked");
		await writeFile(join(root, "placeholder"), "keep", "utf8");
		await assert.rejects(prepareOutputDirectory(root), /unmarked output directory/);
		await prepareOutputDirectory(unmarked);
		await writeFile(join(unmarked, "foreign"), "x", "utf8");
		await assert.rejects(prepareOutputDirectory(unmarked), /unmarked output directory/);

		const outputDir = join(root, "owned");
		await generateSessionFixtures({ outputDir, sha: SHA, largeTargetBytes: 8 * 1024, safety });
		await writeFile(join(outputDir, "operator-note.txt"), "keep", "utf8");
		await generateSessionFixtures({ outputDir, sha: SHA, largeTargetBytes: 8 * 1024, safety });
		assert.equal(await readFile(join(outputDir, "operator-note.txt"), "utf8"), "keep");
	});
	assert.throws(() => assertSafeOutputDir("C:/Users/Test/AppData/Roaming/PiDeck", {
		homeDir: "C:/Users/Test",
		appDataDir: "C:/Users/Test/AppData/Roaming",
		localAppDataDir: "C:/Users/Test/AppData/Local",
	}), /userData/);
});
