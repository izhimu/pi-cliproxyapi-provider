import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCliproxyCodexStreams } from "../extensions/codex-stream.ts";
import {
	getCounterpartAgentDir,
	loadAuthConnection,
	loadConfigFile,
	loadConfiguredDefaultSettings,
	loadModelsCache,
} from "../extensions/lib.ts";

describe("omp compatibility", () => {
	it("declares identical extensions in package.json under both pi and omp manifests", () => {
		const pkgPath = join(__dirname, "..", "package.json");
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

		expect(pkg.pi).toBeDefined();
		expect(pkg.omp).toBeDefined();
		expect(pkg.pi.extensions).toEqual(pkg.omp.extensions);
		expect(pkg.keywords).toContain("pi-package");
		expect(pkg.keywords).toContain("omp-package");
		expect(pkg.keywords).toContain("pi-extension");
		expect(pkg.keywords).toContain("omp-extension");

		for (const entry of pkg.omp.extensions) {
			const resolved = join(__dirname, "..", entry);
			expect(existsSync(resolved)).toBe(true);
		}
	});

	it("maps counterpart agent directories between .omp and .pi", () => {
		expect(getCounterpartAgentDir("/home/user/.omp/agent")).toBe("/home/user/.pi/agent");
		expect(getCounterpartAgentDir("/home/user/.pi/agent")).toBe("/home/user/.omp/agent");
		expect(getCounterpartAgentDir("/home/john.omp/.omp/agent")).toBe("/home/john.omp/.pi/agent");
		expect(getCounterpartAgentDir("/tmp/other/agent")).toBeUndefined();
	});

	it("falls back to counterpart agent directory for config and default settings", () => {
		const tempBase = mkdtempSync(join(tmpdir(), "omp-compat-test-"));
		const piDir = join(tempBase, ".pi", "agent");
		const ompDir = join(tempBase, ".omp", "agent");

		try {
			// Write config in .pi/agent only
			const configData = { baseUrl: "http://127.0.0.1:8317", fast: true };
			const settingsData = { defaultProvider: "cliproxyapi", defaultModel: "gpt-4o" };
			const authData = {
				cliproxyapi: {
					type: "oauth",
					access: "sk-test-token",
					refresh: JSON.stringify({ baseUrl: "http://127.0.0.1:8317" }),
				},
			};

			loadConfigFile(ompDir); // empty initially

			mkdirSync(piDir, { recursive: true });
			mkdirSync(ompDir, { recursive: true });

			writeFileSync(join(piDir, "cliproxyapi.json"), JSON.stringify(configData), "utf8");
			writeFileSync(join(piDir, "settings.json"), JSON.stringify(settingsData), "utf8");
			writeFileSync(join(piDir, "auth.json"), JSON.stringify(authData), "utf8");
			writeFileSync(
				join(piDir, "cliproxyapi-models.json"),
				JSON.stringify({
					fetchedAt: Date.now(),
					modelsUrl: "http://127.0.0.1:8317/v1/models?client_version=pi",
					inferenceBaseUrl: "http://127.0.0.1:8317/backend-api/",
					models: [{ id: "gpt-4o", name: "GPT-4o", reasoning: false, input: ["text"] }],
					fastModelIds: ["gpt-4o"],
				}),
				"utf8",
			);
			// Reading from ompDir falls back to piDir counterpart
			const loadedConfig = loadConfigFile(ompDir);
			expect(loadedConfig.baseUrl).toBe("http://127.0.0.1:8317");
			expect(loadedConfig.fast).toBe(true);

			const loadedSettings = loadConfiguredDefaultSettings(ompDir);
			expect(loadedSettings.defaultProvider).toBe("cliproxyapi");
			expect(loadedSettings.defaultModel).toBe("gpt-4o");

			const loadedAuth = loadAuthConnection(ompDir, "cliproxyapi");
			expect(loadedAuth?.apiKey).toBe("sk-test-token");
			expect(loadedAuth?.baseUrl).toBe("http://127.0.0.1:8317");

			const loadedCache = loadModelsCache(ompDir, "http://127.0.0.1:8317");
			expect(loadedCache?.models.length).toBe(1);
			expect(loadedCache?.fastModelIds).toContain("gpt-4o");
		} finally {
			rmSync(tempBase, { recursive: true, force: true });
		}
	});

	it("loads codex streams provider definition with proper api tag", async () => {
		const streams = await loadCliproxyCodexStreams(["cliproxyapi"]);
		expect(streams.api).toBe("cliproxyapi-codex-responses");
		expect(typeof streams.streamSimple).toBe("function");
		expect(typeof streams.stream).toBe("function");
		expect(typeof streams.closeOpenAICodexWebSocketSessions).toBe("function");
	});
});
