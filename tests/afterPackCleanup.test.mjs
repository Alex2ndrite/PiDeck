import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const asar = require("@electron/asar");
const afterPackCleanup = require("../scripts/after-pack-cleanup.js").default;

async function put(path, content) {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, "utf8");
}

function normalizedEntries(archive) {
	return asar.listPackage(archive).map((entry) => entry.replaceAll("\\", "/").replace(/^\//, ""));
}

test("afterPack cleanup preserves the Lark SDK package main entry", async () => {
	const appOutDir = await mkdtemp(join(tmpdir(), "pideck-after-pack-"));
	try {
		const sourceDir = join(appOutDir, "fixture");
		const archive = join(appOutDir, "resources", "app.asar");
		const packageDir = join(sourceDir, "node_modules", "@larksuiteoapi", "node-sdk");

		await put(join(packageDir, "package.json"), JSON.stringify({ main: "./lib/index.js" }));
		await put(join(packageDir, "lib", "index.js"), "module.exports = {};\n");
		await put(join(packageDir, "es", "index.js"), "export {};\n");
		await put(join(packageDir, "README.md"), "fixture documentation\n");
		await mkdir(dirname(archive), { recursive: true });
		await asar.createPackage(sourceDir, archive);

		await afterPackCleanup({ appOutDir });

		const entries = normalizedEntries(archive);
		assert.ok(
			entries.includes("node_modules/@larksuiteoapi/node-sdk/lib/index.js"),
			"the package.json main entry must remain in the final asar",
		);
		assert.equal(
			entries.includes("node_modules/@larksuiteoapi/node-sdk/README.md"),
			false,
			"the fixture must exercise an asar repack through normal documentation cleanup",
		);
	} finally {
		await rm(appOutDir, { recursive: true, force: true });
	}
});
