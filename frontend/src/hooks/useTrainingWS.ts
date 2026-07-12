/**
 * 训练 WebSocket 单例 — 会话级双向实时通道（两车道模型之 WS 车道）。
 *
 * ┌── HTTP ──── 请求/响应：CRUD、登录、拉数据（不动）
 * ├── SSE ───── 请求流式响应：LLM 聊天、QA（@/api/sse.ts:readSSEStream）
 * └── WS ────── 会话级双向实时：查体、评分、scene:state、主动追问
 *
 * WS 负责"服务端主动推送 + 客户端命令"，每条连接鉴定用户身份后接入
 * backend RealtimeHub（见 backend/contexts/training/router/ws.py）。
 */
import { useCallback, useEffect, useRef } from "react";
import useAuthStore from "@/stores/authStore";

export interface TrainingWSMessage {
	type: string;
	[key: string]: unknown;
}

export interface TrainingWS {
	send(msg: TrainingWSMessage): void;
	sendExam(recordId: number, opType: string): void;
}

const _listeners = new Set<(msg: TrainingWSMessage) => void>();
let _ws: WebSocket | null = null;
let _retryCount = 0;
let _retryTimer: ReturnType<typeof setTimeout> | null = null;
let _aborted = false;
let _connected = false;
let _refCount = 0;
let _authRetried = false;

function buildWsUrl(): string {
	const token = useAuthStore.getState().token ?? "";
	const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
	return `${proto}//${window.location.host}/api/training/ws?token=${encodeURIComponent(token)}`;
}

function _connect() {
	if (_aborted || _ws) return;

	const ws = new WebSocket(buildWsUrl());
	_ws = ws;

	ws.onopen = () => {
		_retryCount = 0;
		_authRetried = false;
		_connected = true;
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
	};

	ws.onclose = (ev) => {
		_ws = null;
		_connected = false;
		if (_aborted) return;
		// 4001 = 鉴权失败。可能是 access token 已过期 —— 先刷新一次令牌再重连；
		// 若刷新后仍 4001，说明 refresh token 也失效，放弃（等待显式重连/登出）。
		if (ev.code === 4001) {
			if (_authRetried) return;
			_authRetried = true;
			useAuthStore
				.getState()
				.refreshAuth()
				.then((ok) => {
					if (ok && !_aborted && !_ws) _connect();
				})
				.catch(() => {});
			return;
		}
		// 指数退避 + ±50% 抖动，避免后端重启时 21 个客户端齐步重连（惊群）。
		const base = Math.min(1000 * 2 ** _retryCount, 30000);
		const delay = base / 2 + Math.random() * (base / 2);
		_retryCount = Math.min(_retryCount + 1, 5);
		_retryTimer = setTimeout(_connect, delay);
	};
}

function _send(msg: TrainingWSMessage) {
	if (_ws && _ws.readyState === WebSocket.OPEN) {
		_ws.send(JSON.stringify(msg));
	}
}

/**
 * Shared training WebSocket — singleton connection per page lifecycle.
 * All callers share the same underlying WS connection.
 */
export function useTrainingWS(
	onEvent?: (msg: TrainingWSMessage) => void,
): TrainingWS {
	const onEventRef = useRef(onEvent);
	onEventRef.current = onEvent;

	useEffect(() => {
		if (!onEvent) return;
		const handler = (msg: TrainingWSMessage) => {
			onEventRef.current?.(msg);
		};
		_listeners.add(handler);
		return () => { _listeners.delete(handler); };
	}, [onEvent]);

	useEffect(() => {
		_refCount += 1;
		if (_refCount === 1) {
			_aborted = false;
			_connect();
		}
		return () => {
			_refCount -= 1;
			if (_refCount === 0) {
				_aborted = true;
				if (_retryTimer) { clearTimeout(_retryTimer); _retryTimer = null; }
				if (_ws) { _ws.close(); _ws = null; }
				_connected = false;
				_listeners.clear();
			}
		};
	}, []);

	const sendExam = useCallback((recordId: number, opType: string) => {
		_send({ type: "exam", record_id: recordId, op_type: opType });
	}, []);

	return { send: _send, sendExam };
}
