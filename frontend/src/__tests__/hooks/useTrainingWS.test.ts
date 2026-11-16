import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 训练 WS 的接入身份与自愈节奏。
 *
 * 两个线上可观察的行为：
 * 1. 连接 URL 必须带「当前视角 + 当前院校」——浏览器 WebSocket 不能带请求头，缺了它服务端
 *    按默认视角解析，平台账号落到 `platform` 视角（无 `training_access`）→ 4003 → 训练页
 *    横幅「实时推送连接中断」且永不恢复。
 * 2. 服务端 101 后立刻关闭时退避不得清零，否则退化成每 0.5–1s 一条重连的抖动。
 */

class FakeSocket {
	static instances: FakeSocket[] = [];
	static OPEN = 1;
	url: string;
	readyState = 0;
	onopen: (() => void) | null = null;
	onclose: ((ev: { code: number; reason: string }) => void) | null = null;
	onmessage: ((ev: { data: string }) => void) | null = null;
	onerror: (() => void) | null = null;

	constructor(url: string) {
		this.url = url;
		FakeSocket.instances.push(this);
	}

	send() {}

	close() {
		this.readyState = 3;
	}

	/** 服务端 101 */
	accept() {
		this.readyState = FakeSocket.OPEN;
		this.onopen?.();
	}

	/** 服务端关连接 */
	shut(code: number) {
		this.readyState = 3;
		this.onclose?.({ code, reason: "" });
	}
}

// 这里的动态导入是刻意的：`useTrainingWS` 是模块级单例（连接、退避计数、监听器都在模块作用域），
// 静态导入会让两个用例共用同一份已连接状态。`vi.resetModules()` 之后必须重新导入整条依赖图，
// 才能拿到「新模块实例 + 它自己的 store 实例」。
async function loadModules() {
	const { usePersonaStore } = await import("@/stores/personaStore");
	const { useSchoolScopeStore } = await import("@/stores/schoolScopeStore");
	const authStore = (await import("@/stores/authStore")).default;
	const { useTrainingWS } = await import("@/hooks/useTrainingWS");
	return { usePersonaStore, useSchoolScopeStore, authStore, useTrainingWS };
}

beforeEach(() => {
	vi.resetModules();
	// jsdom 环境里 localStorage 不可用（node 未给 --localstorage-file）：zustand 的 persist
	// 中间件会直接读这个全局，缺了就在 setState 时炸。用例自己显式设置 store 状态。
	vi.stubGlobal("localStorage", {
		getItem: () => null,
		setItem: () => {},
		removeItem: () => {},
		clear: () => {},
	});
	FakeSocket.instances = [];
	vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("useTrainingWS", () => {
	it("连接 URL 带当前视角与院校，切视角即换连接", async () => {
		const { usePersonaStore, useSchoolScopeStore, authStore, useTrainingWS } = await loadModules();
		authStore.setState({ token: "tok-1" });
		usePersonaStore.setState({ available: ["student", "platform"], active: "student" });
		useSchoolScopeStore.getState().setSchool({
			id: 7,
			name: "测试院校",
			themeColor: null,
			hasLogo: false,
			logoUpdatedAt: null,
		});

		const { unmount } = renderHook(() => useTrainingWS(() => {}, true));

		expect(FakeSocket.instances).toHaveLength(1);
		const first = new URL(FakeSocket.instances[0].url);
		expect(first.pathname).toBe("/api/training/ws");
		expect(first.searchParams.get("token")).toBe("tok-1");
		expect(first.searchParams.get("persona")).toBe("student");
		expect(first.searchParams.get("school")).toBe("7");

		act(() => {
			usePersonaStore.getState().setActive("platform");
		});
		expect(FakeSocket.instances).toHaveLength(2);
		expect(new URL(FakeSocket.instances[1].url).searchParams.get("persona")).toBe("platform");

		unmount();
	});

	it("101 后立刻关闭不重置退避", async () => {
		vi.useFakeTimers();
		const { usePersonaStore, authStore, useTrainingWS } = await loadModules();
		authStore.setState({ token: "tok-2" });
		usePersonaStore.setState({ available: ["student"], active: "student" });

		const { unmount } = renderHook(() => useTrainingWS(() => {}, true));
		expect(FakeSocket.instances).toHaveLength(1);

		act(() => {
			FakeSocket.instances[0].accept();
			FakeSocket.instances[0].shut(4003);
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1000);
		});
		expect(FakeSocket.instances).toHaveLength(2);

		act(() => {
			FakeSocket.instances[1].accept();
			FakeSocket.instances[1].shut(4003);
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(900);
		});
		// 旧实现会在 onopen 清零退避 → 第二次仍在 0.5–1s 内重连
		expect(FakeSocket.instances).toHaveLength(2);

		unmount();
	});
});
