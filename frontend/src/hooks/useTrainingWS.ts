/**
 * 训练 WebSocket 单例 — 会话级双向实时通道（两车道模型之 WS 车道）。
 *
 * ┌── HTTP ──── 请求/响应：CRUD、登录、拉数据（不动）
 * ├── SSE ───── 请求流式响应：LLM 聊天、QA（@/api/sse.ts:readSSEStream）
 * └── WS ────── 会话级双向实时：查体、评分、scene:state、主动追问
 *
 * WS 负责"服务端主动推送 + 客户端命令"，每条连接鉴定用户身份后接入
 * backend RealtimeHub（见 backend/contexts/training/router/ws.py）。
 *
 * 自愈策略：指数退避 + 抖动，退避耗尽后转入 30s 周期探测（永不放弃）；
 * 监听 online / visibilitychange 即时重连；4001 刷新失败降级为普通退避。
 */
import { useCallback, useEffect, useRef } from "react";
import useAuthStore from "@/stores/authStore";

export interface TrainingWSMessage {
	type: string;
	[key: string]: unknown;
}

export interface TrainingWS {
	send(msg: TrainingWSMessage): void;
	sendTool(recordId: number, tool: string, action: string, params?: Record<string, unknown>): string;
}

const _listeners = new Set<(msg: TrainingWSMessage) => void>();
const _connListeners = new Set<(connected: boolean) => void>();
const _pending: TrainingWSMessage[] = [];
let _ws: WebSocket | null = null;
let _retryCount = 0;
let _retryTimer: ReturnType<typeof setTimeout> | null = null;
let _aborted = false;
let _connected = false;
let _refCount = 0;
let _authRetried = false;
let _removeNetworkListeners: (() => void) | null = null;

function _setConnected(v: boolean) {
	if (_connected === v) return;
	_connected = v;
	for (const fn of _connListeners) {
		try { fn(v); } catch { /* ignore */ }
	}
}

/** 订阅 WS 连接状态（立即以当前值回调一次）。用于训练页连接状态指示。 */
export function subscribeWSConnection(fn: (connected: boolean) => void): () => void {
	_connListeners.add(fn);
	fn(_connected);
	return () => { _connListeners.delete(fn); };
}

function buildWsUrl(): string {
	const token = useAuthStore.getState().token ?? "";
	const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${proto}//${window.location.host}/api/training/ws?token=${encodeURIComponent(token)}`;
}

/** 网络恢复 / 回到前台时立即重连（若当前无活动连接） */
function _onNetworkBack() {
	if (_aborted || _ws) return;
	_retryTimer = null;
	_connect();
}

function _installNetworkListeners() {
	window.addEventListener("online", _onNetworkBack);
	document.addEventListener("visibilitychange", _onNetworkBack);
	_removeNetworkListeners = () => {
		window.removeEventListener("online", _onNetworkBack);
		document.removeEventListener("visibilitychange", _onNetworkBack);
	};
}

function _uninstallNetworkListeners() {
	_removeNetworkListeners?.();
	_removeNetworkListeners = null;
}

/** 指数退避 + 抖动；退避耗尽后固定 ~30s 周期探测，永不放弃 */
function _scheduleReconnect() {
	if (_aborted || _retryTimer || _ws) return;
	const base = Math.min(1000 * 2 ** Math.min(_retryCount, 5), 30_000);
	const delay = _retryCount >= 6 ? 30_000 : base / 2 + Math.random() * (base / 2);
	_retryCount = Math.min(_retryCount + 1, 8);
	_retryTimer = setTimeout(() => {
		_retryTimer = null;
		_connect();
	}, delay);
}

function _connect() {
	if (_aborted) return;
	// Reset auth-retry gate per connection attempt — each fresh WebSocket
	// gets one 4001→refresh chance (previously only reset in onopen, so a
	// connection that immediately 4001'd never got a second chance).
	_authRetried = false;
	if (_ws) {
		const old = _ws;
		_ws = null;
		old.onclose = null;
		old.onerror = null;
		old.onopen = null;
		old.onmessage = null;
		setTimeout(() => { try { old.close(); } catch { /* ignore */ } }, 0);
	}

	const wasReconnect = _retryCount > 0;
	const ws = new WebSocket(buildWsUrl());
	_ws = ws;
	ws.onopen = () => {
		_retryCount = 0;
		_setConnected(true);
		// 重连成功广播：训练视图可据此同步场景/状态
		if (wasReconnect) {
			try { window.dispatchEvent(new CustomEvent("training-ws:reconnected")); } catch { /* ignore */ }
		}
		while (_pending.length > 0) {
			const msg = _pending.shift()!;
			_send(msg);
		}
	};

	ws.onmessage = (ev) => {
		try {
			const msg = JSON.parse(ev.data as string) as TrainingWSMessage;
			for (const fn of _listeners) {
				try { fn(msg); } catch { /* ignore */ }
			}
		} catch {
			// ignore malformed messages
		}
	};

	ws.onerror = () => {
		// will trigger onclose
		console.warn("[TrainingWS] socket error (onclose will follow)");
	};

	ws.onclose = (ev) => {
		// Only clear _ws if THIS socket is still the active one.
		// A stale onclose from a superseded socket must not destroy
		// the reference to a newer connection.
		if (_ws === ws) _ws = null;
		_setConnected(false);
		if (_aborted) return;
		console.warn("[TrainingWS] closed code=%d reason=%s", ev.code, ev.reason || "(none)");
		// 4001 = 鉴权失败
		if (ev.code === 4001) {
			if (_authRetried) {
				// 刷新已试过一次仍失败 → 降级为普通退避重连（不永久放弃）
				_scheduleReconnect();
				return;
			}
			_authRetried = true;
			useAuthStore
				.getState()
				.refreshAuth()
				.then((ok) => {
					if (_aborted) return;
					if (ok && !_ws) _connect();
					else _scheduleReconnect();
				})
				.catch(() => _scheduleReconnect());
			return;
		}
		_scheduleReconnect();
	};
	const pingTimer = setInterval(() => {
		if (_ws === ws && ws.readyState === WebSocket.OPEN) {
			_send({ type: "ping" });
		}
	}, 25_000);
	const _origOnClose = ws.onclose;
	ws.onclose = (ev) => {
		clearInterval(pingTimer);
		if (_origOnClose) _origOnClose.call(ws, ev);
	};
}
function _send(msg: TrainingWSMessage) {
	if (_ws && _ws.readyState === WebSocket.OPEN) {
		_ws.send(JSON.stringify(msg));
	} else {
		_pending.push(msg);
	}
}

/**
 * Shared training WebSocket — singleton connection per page lifecycle.
 * All callers share the same underlying WS connection.
 */
export function useTrainingWS(
	onEvent?: (msg: TrainingWSMessage) => void,
	enabled = true,
): TrainingWS {
	const onEventRef = useRef(onEvent);
	onEventRef.current = onEvent;

	useEffect(() => {
		if (!enabled || !onEvent) return;
		const handler = (msg: TrainingWSMessage) => {
			onEventRef.current?.(msg);
		};
		_listeners.add(handler);
		return () => { _listeners.delete(handler); };
	}, [enabled]);

	useEffect(() => {
		if (!enabled) return;
		_refCount += 1;
		if (_refCount === 1) {
			_aborted = false;
			_retryCount = 0; // 新会话重置退避计数（避免跨会话残留）
			_installNetworkListeners();
			_connect();
		}
		return () => {
			_refCount -= 1;
			if (_refCount === 0) {
				_aborted = true;
				_uninstallNetworkListeners();
				if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
				if (_ws) { const old = _ws; _ws = null; old.onclose = null; setTimeout(() => { try { old.close(); } catch { /* ignore */ } }, 0); _setConnected(false); }
				_pending.length = 0;
			}
		};
	}, [enabled]);

	const sendTool = useCallback((recordId: number, tool: string, action: string, params?: Record<string, unknown>) => {
		const requestId = crypto.randomUUID();
		_send({
			type: "tool",
			request_id: requestId,
			record_id: recordId,
			tool,
			action,
			params: params ?? {},
		});
		return requestId;
	}, []);

	return { send: _send, sendTool };
}
