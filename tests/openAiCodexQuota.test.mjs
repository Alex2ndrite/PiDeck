import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const parserPath = "src/main/usageStats/openAiCodexQuota.ts";
const servicePath = "src/main/usageStats/OpenAiCodexQuotaService.ts";

function load(filePath) {
  const source = readFileSync(filePath, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const sandbox = {
    exports: {},
    require: (id) => {
      if (id === "./openAiCodexQuota") return load(join(import.meta.dirname, "../src/main/usageStats/openAiCodexQuota.ts"));
      return require(id);
    },
    Date,
    AbortController,
    ReadableStream,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(outputText, sandbox, { filename: filePath });
  return sandbox.exports;
}

const { parseOpenAiCodexQuota } = load(join(import.meta.dirname, "../src/main/usageStats/openAiCodexQuota.ts"));
const { OpenAiCodexQuotaService } = load(join(import.meta.dirname, "../src/main/usageStats/OpenAiCodexQuotaService.ts"));

const payload = (primary, secondary = null) => ({
  plan_type: "pro",
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: primary,
    secondary_window: secondary,
  },
});

test("normalizes quota windows by duration and clamps percentage", () => {
  const result = parseOpenAiCodexQuota(payload(
    { used_percent: 120, limit_window_seconds: 604800, reset_at: 1762650589 },
    { used_percent: -4, limit_window_seconds: 18000, reset_at: 1762147153 },
  ), 1700000000000);
  assert.equal(result.weekly.usedPercent, 100);
  assert.equal(result.fiveHour.usedPercent, 0);
  assert.equal(result.weekly.resetsAt, 1762650589000);
});

test("supports null secondary and a weekly-only primary window", () => {
  const result = parseOpenAiCodexQuota(payload({ used_percent: 31, limit_window_seconds: 604800 }), 1700000000000);
  assert.equal(result.fiveHour, null);
  assert.equal(result.weekly.usedPercent, 31);
});

test("falls back to reset_after_seconds and accepts a missing plan type", () => {
  const result = parseOpenAiCodexQuota({
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: {
        used_percent: 12,
        limit_window_seconds: 18000,
        reset_after_seconds: 90,
      },
      secondary_window: null,
    },
  }, 1700000000000);
  assert.equal(result.planType, null);
  assert.equal(result.fiveHour.resetsAt, 1700000090000);
  assert.equal(result.weekly, null);
});

test("rejects malformed response without exposing partial data", () => {
  assert.equal(parseOpenAiCodexQuota({ plan_type: "pro", rate_limit: {} }), null);
  assert.equal(parseOpenAiCodexQuota({}), null);
});

test("sends only access and account id, never refresh", async () => {
  const calls = [];
  const config = {
    async getAuthConfig() {
      return { parsed: { "openai-codex": { type: "oauth", access: "access-secret", refresh: "refresh-secret", accountId: "acct-secret", expires: Date.now() + 60000 } } };
    },
  };
  const service = new OpenAiCodexQuotaService(config, async (_url, init) => {
    calls.push(init);
    return { ok: true, status: 200, async text() { return JSON.stringify(payload({ used_percent: 1, limit_window_seconds: 18000 })); } };
  });
  const result = await service.get({ force: true });
  assert.equal(result.status, "ready");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.Authorization, "Bearer access-secret");
  assert.equal(calls[0].headers["ChatGPT-Account-ID"], "acct-secret");
  assert.equal(Object.keys(calls[0].headers).length, 2);
  assert.equal(JSON.stringify(result).includes("refresh-secret"), false);
});

test("returns stale snapshot after a failed refresh", async () => {
  let fail = false;
  const config = { async getAuthConfig() { return { parsed: { "openai-codex": { type: "oauth", access: "a", accountId: "id" } } }; } };
  const service = new OpenAiCodexQuotaService(config, async () => {
    if (fail) throw new Error("offline");
    return { ok: true, status: 200, async text() { return JSON.stringify(payload({ used_percent: 10, limit_window_seconds: 18000 })); } };
  });
  assert.equal((await service.get({ force: true })).status, "ready");
  fail = true;
  const result = await service.get({ force: true });
  assert.equal(result.status, "stale");
  assert.equal(result.snapshot.fiveHour.usedPercent, 10);
  assert.equal(result.reason, "network");
});

test("retries one unauthorized response only after pi changes credentials", async () => {
  let reads = 0;
  let calls = 0;
  const config = {
    async getAuthConfig() {
      reads += 1;
      const access = reads > 1 ? "new-access" : "old-access";
      return { parsed: { "openai-codex": { type: "oauth", access, accountId: "id" } } };
    },
  };
  const service = new OpenAiCodexQuotaService(config, async (_url, init) => {
    calls += 1;
    if (calls === 1) return { ok: false, status: 401, async text() { return "private"; } };
    assert.equal(init.headers.Authorization, "Bearer new-access");
    return { ok: true, status: 200, async text() { return JSON.stringify(payload({ used_percent: 2, limit_window_seconds: 18000 })); } };
  });
  assert.equal((await service.get({ force: true })).status, "ready");
  assert.equal(calls, 2);
});

test("does not retry unauthorized when pi credentials are unchanged", async () => {
  let reads = 0;
  let calls = 0;
  const config = {
    async getAuthConfig() {
      reads += 1;
      return { parsed: { "openai-codex": { type: "oauth", access: "same-access", accountId: "id" } } };
    },
  };
  const service = new OpenAiCodexQuotaService(config, async () => {
    calls += 1;
    return { ok: false, status: 401, async text() { return "private"; } };
  });
  const result = await service.get({ force: true });
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "unauthorized");
  assert.equal(reads, 2);
  assert.equal(calls, 1);
});

test("does not request when credentials are absent or expired", async () => {
  let calls = 0;
  const transport = async () => { calls += 1; throw new Error("must not call"); };
  const missing = new OpenAiCodexQuotaService({ async getAuthConfig() { return { parsed: {} }; } }, transport);
  assert.equal((await missing.get({ force: true })).reason, "not-configured");
  const expired = new OpenAiCodexQuotaService({ async getAuthConfig() { return { parsed: { "openai-codex": { type: "oauth", access: "a", accountId: "id", expires: Date.now() - 1 } } }; } }, transport);
  assert.equal((await expired.get({ force: true })).reason, "expired");
  assert.equal(calls, 0);
});

test("deduplicates concurrent requests and serves TTL cache", async () => {
  let calls = 0;
  const config = { async getAuthConfig() { return { parsed: { "openai-codex": { type: "oauth", access: "a", accountId: "id" } } }; } };
  const service = new OpenAiCodexQuotaService(config, async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { ok: true, status: 200, async text() { return JSON.stringify(payload({ used_percent: 3, limit_window_seconds: 18000 })); } };
  });
  const [first, second] = await Promise.all([service.get({ force: true }), service.get({ force: true })]);
  assert.equal(first.status, "ready");
  assert.equal(second.status, "ready");
  assert.equal(calls, 1);
  await service.get();
  assert.equal(calls, 1);
});

test("a cached read joins an in-flight forced refresh", async () => {
  let calls = 0;
  let releaseRefresh;
  const config = { async getAuthConfig() { return { parsed: { "openai-codex": { type: "oauth", access: "a", accountId: "id" } } }; } };
  const service = new OpenAiCodexQuotaService(config, async () => {
    calls += 1;
    if (calls === 2) await new Promise((resolve) => { releaseRefresh = resolve; });
    return { ok: true, status: 200, async text() { return JSON.stringify(payload({ used_percent: calls, limit_window_seconds: 18000 })); } };
  });
  await service.get({ force: true });
  const forced = service.get({ force: true });
  while (!releaseRefresh) await new Promise((resolve) => setTimeout(resolve, 0));
  const ordinary = service.get();
  releaseRefresh();
  const [forcedResult, ordinaryResult] = await Promise.all([forced, ordinary]);
  assert.equal(calls, 2);
  assert.equal(forcedResult.snapshot.fiveHour.usedPercent, 2);
  assert.equal(ordinaryResult.snapshot.fiveHour.usedPercent, 2);
});

test("keys TTL and stale snapshots by the current pi account", async () => {
  let accountId = "account-a";
  let calls = 0;
  const config = {
    async getAuthConfig() {
      if (!accountId) return { parsed: {} };
      return { parsed: { "openai-codex": { type: "oauth", access: `access-${accountId}`, accountId } } };
    },
  };
  const service = new OpenAiCodexQuotaService(config, async (_url, init) => {
    calls += 1;
    const used = init.headers["ChatGPT-Account-ID"] === "account-a" ? 10 : 20;
    return { ok: true, status: 200, async text() { return JSON.stringify(payload({ used_percent: used, limit_window_seconds: 18000 })); } };
  });

  const first = await service.get({ force: true });
  assert.equal(first.snapshot.fiveHour.usedPercent, 10);
  accountId = "account-b";
  const switched = await service.get();
  assert.equal(switched.snapshot.fiveHour.usedPercent, 20, "new account must bypass account-a TTL");
  assert.equal(calls, 2);

  accountId = "";
  const missing = await service.get();
  assert.equal(missing.status, "unavailable", "missing current identity must not expose another account's stale snapshot");
  assert.equal(missing.snapshot, null);
});

test("rejects oversized bodies before reading response text", async () => {
  let textRead = false;
  const config = { async getAuthConfig() { return { parsed: { "openai-codex": { type: "oauth", access: "a", accountId: "id" } } }; } };
  const service = new OpenAiCodexQuotaService(config, async () => ({
    ok: true,
    status: 200,
    headers: { get(name) { return name === "content-length" ? String(70 * 1024) : null; } },
    async text() { textRead = true; return "{}"; },
  }));
  const result = await service.get({ force: true });
  assert.equal(result.reason, "invalid-response");
  assert.equal(textRead, false);
});

test("parses a bounded streamed response used by Electron net.fetch", async () => {
  const config = { async getAuthConfig() { return { parsed: { "openai-codex": { type: "oauth", access: "a", accountId: "id" } } }; } };
  const encoded = new TextEncoder().encode(JSON.stringify(payload({ used_percent: 44, limit_window_seconds: 18000 })));
  const service = new OpenAiCodexQuotaService(config, async () => ({
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoded);
        controller.close();
      },
    }),
    async text() { throw new Error("stream path should be used"); },
  }));
  const result = await service.get({ force: true });
  assert.equal(result.status, "ready");
  assert.equal(result.snapshot.fiveHour.usedPercent, 44);
});

test("logs only safe failure metadata", async () => {
  const messages = [];
  const config = { async getAuthConfig() { return { parsed: { "openai-codex": { type: "oauth", access: "access-secret", refresh: "refresh-secret", accountId: "account-secret" } } }; } };
  const service = new OpenAiCodexQuotaService(
    config,
    async () => ({ ok: false, status: 403, async text() { return "server-secret"; } }),
    { warn(message) { messages.push(message); } },
  );
  const result = await service.get({ force: true });
  assert.equal(result.reason, "forbidden");
  const logged = messages.join("\n");
  for (const secret of ["access-secret", "refresh-secret", "account-secret", "server-secret"]) {
    assert.equal(logged.includes(secret), false, `${secret} must not be logged`);
  }
});
