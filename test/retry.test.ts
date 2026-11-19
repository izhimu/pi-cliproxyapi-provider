import {
	type AssistantMessage,
	type AssistantMessageEventStream,
	createAssistantMessageEventStream,
	isRetryableAssistantError,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeTransientNetworkError, registerTransientNetworkErrorRetry } from "../extensions/retry.ts";

const { getCustomApiMock, registerCustomApiMock } = vi.hoisted(() => ({
	getCustomApiMock: vi.fn(),
	registerCustomApiMock: vi.fn(),
}));

vi.mock("@earendil-works/pi-ai", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	getCustomApi: getCustomApiMock,
	registerCustomApi: registerCustomApiMock,
}));

beforeEach(() => {
	getCustomApiMock.mockReset();
	registerCustomApiMock.mockReset();
});

const TRANSIENT_STREAM_ERRORS = [
	"Codex error: read tcp 172.16.209.2:57303->172.64.155.209:443: use of closed network connection",
	"Error: Codex error: stream error: stream disconnected before completion: stream closed before response.completed",
	"Codex error: invalid SSE data JSON (len=33181)",
];

function assistantError(errorMessage: string, provider = "cliproxyapi"): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "cliproxyapi-codex-responses",
		provider,
		model: "gpt-5.6-sol",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage,
		timestamp: Date.now(),
	};
}

describe("transient network error normalization", () => {
	it.each(TRANSIENT_STREAM_ERRORS)("makes CLIProxyAPI transient stream error retryable: %s", (errorMessage) => {
		const original = assistantError(errorMessage);
		expect(isRetryableAssistantError(original)).toBe(false);

		const normalized = normalizeTransientNetworkError(original);
		expect(normalized).not.toBe(original);
		expect(normalized.errorMessage).toBe(`network error: ${errorMessage}`);
		expect(isRetryableAssistantError(normalized)).toBe(true);
	});

	it("leaves existing retryable and unrelated errors unchanged", () => {
		const retryable = assistantError("WebSocket closed 1006");
		const unrelated = assistantError("Codex error: invalid request");

		expect(normalizeTransientNetworkError(retryable)).toBe(retryable);
		expect(normalizeTransientNetworkError(unrelated)).toBe(unrelated);
	});

	it("only rewrites assistant errors from the registered provider", () => {
		let handler: ((event: any, ctx: ExtensionContext) => unknown) | undefined;
		const pi = {
			on: (event: string, candidate: (event: any, ctx: ExtensionContext) => unknown) => {
				if (event === "message_end") handler = candidate;
			},
		} as unknown as ExtensionAPI;
		registerTransientNetworkErrorRetry(pi, "cliproxyapi");
		if (!handler) throw new Error("message_end handler was not registered");

		const matching = assistantError(TRANSIENT_STREAM_ERRORS[0]);
		const replacement = handler({ type: "message_end", message: matching }, {} as ExtensionContext) as {
			message: AssistantMessage;
		};
		expect(replacement.message.errorMessage).toBe(`network error: ${TRANSIENT_STREAM_ERRORS[0]}`);

		const otherProvider = assistantError(TRANSIENT_STREAM_ERRORS[0], "other");
		expect(handler({ type: "message_end", message: otherProvider }, {} as ExtensionContext)).toBeUndefined();
	});

	it("normalizes the OMP error stream before the host consumes it", async () => {
		const source = createAssistantMessageEventStream();
		const streamSimple = vi.fn(() => source);
		getCustomApiMock.mockReturnValue({ stream: streamSimple, streamSimple, sourceId: "test-source" });
		const pi = { on: vi.fn() } as unknown as ExtensionAPI;
		registerTransientNetworkErrorRetry(pi, "cliproxyapi");

		expect(registerCustomApiMock).toHaveBeenCalledWith(
			"cliproxyapi-codex-responses",
			expect.any(Function),
			"test-source",
			expect.any(Function),
		);
		const wrappedStreamSimple = registerCustomApiMock.mock.calls[0]?.[1] as (
			model: unknown,
			context: unknown,
		) => AssistantMessageEventStream;
		const hostStream = wrappedStreamSimple(
			{ api: "cliproxyapi-codex-responses", provider: "cliproxyapi", id: "gpt-5.6-sol" },
			{ messages: [] },
		);
		const original = assistantError(TRANSIENT_STREAM_ERRORS[0]);
		source.push({ type: "error", reason: "error", error: original });
		source.end();

		const delivered = await hostStream.result();
		expect(delivered.errorMessage).toBe(`network error: ${TRANSIENT_STREAM_ERRORS[0]}`);
		expect(isRetryableAssistantError(delivered)).toBe(true);
		expect(original.errorMessage).toBe(TRANSIENT_STREAM_ERRORS[0]);
	});
});
