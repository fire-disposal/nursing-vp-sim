import { describe, expect, it, vi } from "vitest";
import { createMessageBus, TypedMessageBus } from "@/engine/MessageBus";

describe("createMessageBus", () => {
	it("delivers events to subscribers", () => {
		const bus = createMessageBus();
		const handler = vi.fn();
		bus.on("stream:chunk", handler);
		bus.emit("stream:chunk", "你好");
		expect(handler).toHaveBeenCalledWith("你好");
	});

	it("unsubscribes via returned cleanup", () => {
		const bus = createMessageBus();
		const handler = vi.fn();
		const off = bus.on("stream:chunk", handler);
		off();
		bus.emit("stream:chunk", "x");
		expect(handler).not.toHaveBeenCalled();
	});

	it("unsubscribes via off", () => {
		const bus = createMessageBus();
		const handler = vi.fn();
		bus.on("stream:chunk", handler);
		bus.off("stream:chunk", handler);
		bus.emit("stream:chunk", "x");
		expect(handler).not.toHaveBeenCalled();
	});

	it("emitting with no listeners is a no-op", () => {
		const bus = createMessageBus();
		expect(() => bus.emit("nothing", 1)).not.toThrow();
	});

	it("isolates events by name", () => {
		const bus = createMessageBus();
		const a = vi.fn();
		const b = vi.fn();
		bus.on("a", a);
		bus.on("b", b);
		bus.emit("a");
		expect(a).toHaveBeenCalled();
		expect(b).not.toHaveBeenCalled();
	});

	it("handler exceptions do not break other handlers", () => {
		const bus = createMessageBus();
		const bad = () => {
			throw new Error("handler boom");
		};
		const good = vi.fn();
		bus.on("e", bad);
		bus.on("e", good);
		expect(() => bus.emit("e")).not.toThrow();
		expect(good).toHaveBeenCalled();
	});

	it("listEvents reports registered event names", () => {
		const bus = createMessageBus();
		bus.on("one", vi.fn());
		bus.on("two", vi.fn());
		expect(bus.listEvents().sort()).toEqual(["one", "two"]);
	});

	it("multiple handlers on same event all receive it", () => {
		const bus = createMessageBus();
		const h1 = vi.fn();
		const h2 = vi.fn();
		bus.on("score:ready", h1);
		bus.on("score:ready", h2);
		bus.emit("score:ready", { total_score: 90 });
		expect(h1).toHaveBeenCalledWith({ total_score: 90 });
		expect(h2).toHaveBeenCalledWith({ total_score: 90 });
	});
});

describe("TypedMessageBus", () => {
	it("delegates typed events to raw bus", () => {
		const raw = createMessageBus();
		const typed = new TypedMessageBus(raw);
		const handler = vi.fn();
		typed.on("emotion:changed", handler);
		typed.emit("emotion:changed", { trust: 70 });
		expect(handler).toHaveBeenCalledWith({ trust: 70 });
	});

	it("exposes listEvents and off", () => {
		const raw = createMessageBus();
		const typed = new TypedMessageBus(raw);
		const handler = vi.fn();
		typed.on("tts:start", handler);
		typed.off("tts:start", handler);
		typed.emit("tts:start", "text");
		expect(handler).not.toHaveBeenCalled();
		expect(typed.listEvents()).toEqual(["tts:start"]);
	});
});
