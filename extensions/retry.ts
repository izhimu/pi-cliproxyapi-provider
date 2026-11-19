import * as piAi from "@earendil-works/pi-ai";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	isRetryableAssistantError,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CLIPROXYAPI_CODEX_API, type CliproxyCodexStreamSimple } from "./codex-stream.ts";

const TRANSIENT_STREAM_ERROR_PATTERN =
	/\bclosed network connection\b|\bstream disconnected before completion: stream closed before response\.completed\b|\binvalid SSE data JSON\b/i;
const NETWORK_ERROR_PREFIX = "network error:";

interface OmpCustomApi {
	stream: CliproxyCodexStreamSimple;
	streamSimple: CliproxyCodexStreamSimple;
	sourceId?: string;
}

interface OmpApiRegistry {
	getCustomApi?: (api: string) => OmpCustomApi | undefined;
	registerCustomApi?: (
		api: string,
		streamSimple: CliproxyCodexStreamSimple,
		sourceId?: string,
		stream?: CliproxyCodexStreamSimple,
	) => void;
}

export function normalizeTransientNetworkError(message: AssistantMessage): AssistantMessage {
	if (message.stopReason !== "error" || !message.errorMessage) {
		return message;
	}
	if (isRetryableAssistantError(message) || !TRANSIENT_STREAM_ERROR_PATTERN.test(message.errorMessage)) {
		return message;
	}

	return {
		...message,
		errorMessage: `${NETWORK_ERROR_PREFIX} ${message.errorMessage}`,
	};
}

export function wrapTransientNetworkErrorStream(
	streamSimple: CliproxyCodexStreamSimple,
	providerId: string,
): CliproxyCodexStreamSimple {
	return (model, context, options) => {
		const source = streamSimple(model, context, options);
		if (model.provider !== providerId) return source;

		const target = createAssistantMessageEventStream();
		void (async () => {
			let result: AssistantMessage | undefined;
			try {
				for await (const event of source) {
					if (event.type === "error") {
						result = normalizeTransientNetworkError(event.error);
						target.push({ ...event, error: result });
					} else {
						if (event.type === "done") result = event.message;
						target.push(event);
					}
				}
				result ??= normalizeTransientNetworkError(await source.result());
				target.end(result);
			} catch (error) {
				const failure: AssistantMessage = {
					role: "assistant",
					content: [],
					api: model.api,
					provider: model.provider,
					model: model.id,
					usage: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: 0,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					},
					stopReason: "error",
					errorMessage: error instanceof Error ? error.message : String(error),
					timestamp: Date.now(),
				};
				target.push({ type: "error", reason: "error", error: failure });
				target.end(failure);
			}
		})();
		return target;
	};
}

export function registerTransientNetworkErrorRetry(pi: ExtensionAPI, providerId: string): void {
	const registry = piAi as unknown as OmpApiRegistry;
	const customApi = registry.getCustomApi?.(CLIPROXYAPI_CODEX_API);
	if (customApi && registry.registerCustomApi) {
		registry.registerCustomApi(
			CLIPROXYAPI_CODEX_API,
			wrapTransientNetworkErrorStream(customApi.streamSimple, providerId),
			customApi.sourceId,
			wrapTransientNetworkErrorStream(customApi.stream, providerId),
		);
		return;
	}

	pi.on("message_end", (event) => {
		const message = event.message;
		if (message.role !== "assistant" || message.provider !== providerId) {
			return;
		}

		const normalized = normalizeTransientNetworkError(message);
		if (normalized === message) {
			return;
		}
		return { message: normalized };
	});
}
