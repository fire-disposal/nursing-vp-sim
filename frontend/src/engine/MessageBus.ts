// frontend/src/engine/MessageBus.ts
import type { MessageBus } from "./types";

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
          console.error(`[MessageBus] error in handler for "${event}":`, e);
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
