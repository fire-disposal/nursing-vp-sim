/**
 * 训练 WebSocket 单例 — **仅服务端推送**（评分进度 / 心跳）。
 *
 * ┌── HTTP ──── 请求/响应命令：CRUD、登录、拉数据；**工具/活动写操作**
 * │             （`POST /api/training/{id}/tools`，revision 乐观并发 + idem_key 幂等）
 * ├── SSE ───── 请求流式响应：LLM 聊天（`POST /api/chat/{id}/message/stream`）
 * │             与 QA（@/api/sse.ts:readSSEStream）—— 聊天的唯一写入 owner
 * └── WS ────── 服务端事件推送；客户端只发心跳 ping，**不承载任何业务命令或状态写入**
 *
 * 边界（docs/16 §四·4.2）：状态变更只认 HTTP/SSE 命令；WS 事件只用于
 * 「通知 + 失效查询缓存」（见 @/hooks/useScoringNotifications.ts），不构成第二份业务状态。
 * 每条连接鉴定用户身份后接入 backend RealtimeHub（见 backend/modules/training/router/ws.py）。
 *
 * 自愈策略：指数退避 + 抖动，退避耗尽后转入 30s 周期探测（永不放弃）；
 * 监听 online / visibilitychange 即时重连；4001 刷新失败降级为普通退避。
 */
import { useEffect, useRef } from "react";
import useAuthStore from "@/stores/authStore";

export interface TrainingWSMessage {
	type: string;
	[key: string]: unknown;
}

const _listeners = new Set<(msg: TrainingWSMessage) => void>();
const _connListeners = new Set<(connected: boolean) => void>();
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

	const ws = new WebSocket(buildWsUrl());
	_ws = ws;
	ws.onopen = () => {
		_retryCount = 0;
		_setConnected(true);
		// 重连后不重放任何客户端消息：本通道只收服务端事件，客户端无业务命令可补发。
		// （旧实现在此 flush 离线命令队列并广播 training-ws:reconnected —— 两者都无消费者，
		// 场景同步改走会话详情投影。）
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
			_sendPing();
		}
	}, 25_000);
	const _origOnClose = ws.onclose;
	ws.onclose = (ev) => {
		clearInterval(pingTimer);
		if (_origOnClose) _origOnClose.call(ws, ev);
	};
}

/** 连接保活：本通道唯一的出站消息（无业务命令，因此断线时直接丢弃而非排队重放）。 */
function _sendPing() {
	if (_ws && _ws.readyState === WebSocket.OPEN) {
		_ws.send(JSON.stringify({ type: "ping" }));
	}
}

/**
 * Shared training WebSocket — singleton connection per page lifecycle.
 * All callers share the same underlying WS connection.
 */
export function useTrainingWS(
	onEvent?: (msg: TrainingWSMessage) => void,
	enabled = true,
): void {
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
			}
		};
	}, [enabled]);
}
