export interface MessageBus {
  on(event: string, handler: (...args: any[]) => void): () => void
  emit(event: string, ...args: any[]): void
  off(event: string, handler: (...args: any[]) => void): void
  listEvents(): string[]
}

export interface MockMessageBus extends MessageBus {
  getLog(): Array<{ event: string; args: any[]; ts: number }>
  clearLog(): void
}

export function createMockBus(): MockMessageBus {
  const listeners = new Map<string, Set<(...args: any[]) => void>>()
  const log: Array<{ event: string; args: any[]; ts: number }> = []

  const bus: MessageBus = {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(handler)
      return () => { listeners.get(event)?.delete(handler) }
    },
    emit(event, ...args) {
      log.push({ event, args, ts: performance.now() })
      const handlers = listeners.get(event)
      if (!handlers) return
      for (const h of handlers) {
        try { h(...args) } catch (e) { console.error("[MockBus]", event, e) }
      }
    },
    off(event, handler) { listeners.get(event)?.delete(handler) },
    listEvents() { return Array.from(listeners.keys()) },
  }

  return Object.assign(bus, {
    getLog: () => log,
    clearLog: () => { log.length = 0 },
  }) as MockMessageBus
}
