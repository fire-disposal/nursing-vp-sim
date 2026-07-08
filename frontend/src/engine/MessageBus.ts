import type { MessageBus, ScoreData } from "./types";

export interface BusEvents {
	"stream:chunk": [];
	"stream:done": [text?: string];
	"stream:error": [err: string];
	"training:ended": [];
	"score:ready": [score: ScoreData];
	"score:unavailable": [reason?: string];
	"emotion:changed": [
		{ state: string; trust: number; comfort: number },
	];
	"scene:state": [Partial<import("./scene-state").SceneState>];
	"scene:exam": [{ op_type: string; value: string; label?: string; unit?: string }];
	"initiative:state": [
		{
			elapsed_seconds?: number;
			threshold_seconds?: number;
			percent?: number;
			initiative_count?: number;
			max_reached?: boolean;
		},
	];
	"initiative:triggered": [{ content: string }];
	"tts:provider-status": [{ provider: string; latencyMs: number }];
	"tts:start": [text: string];
	"tts:end": [text: string];
	"tts:error": [message: string];
	"chat:beforeSend": [];
}

export class TypedMessageBus implements MessageBus {
	constructor(private raw: MessageBus) {}

	on<E extends keyof BusEvents>(
		event: E,
		handler: (...args: BusEvents[E]) => void,
	): () => void {
		return this.raw.on(event as string, handler as (...args: any[]) => void);
	}

	emit<E extends keyof BusEvents>(event: E, ...args: BusEvents[E]): void {
		this.raw.emit(event as string, ...args);
	}

	off(event: string, handler: (...args: any[]) => void): void {
		this.raw.off(event, handler);
	}

	listEvents(): string[] {
		return this.raw.listEvents();
	}
}

export function createMessageBus(): MessageBus {
	const listeners = new Map<string, Set<(...args: any[]) => void>>();

	return {
		on(event: string, handler: (...args: any[]) => void): () => void {
			if (!listeners.has(event)) {
				listeners.set(event, new Set());
			}
			listeners.get(event)!.add(handler);
			return () => {
				listeners.get(event)?.delete(handler);
			};
		},

		emit(event: string, ...args: any[]): void {
			const handlers = listeners.get(event);
			if (!handlers) return;
			for (const h of handlers) {
				try {
					h(...args);
				} catch (e) {
					console.error(
						`[MessageBus] error in handler for "${event}":`,
						e,
					);
				}
			}
		},

		off(event: string, handler: (...args: any[]) => void): void {
			listeners.get(event)?.delete(handler);
		},

		listEvents(): string[] {
			return Array.from(listeners.keys());
		},
	};
}
