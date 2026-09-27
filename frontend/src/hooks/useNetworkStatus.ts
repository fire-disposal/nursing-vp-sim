import { useEffect, useRef, useState } from "react";
import { toast } from "@/components/Toast";
import { subscribeWSConnection } from "@/hooks/useTrainingWS";

export function useNetworkStatus() {
	const [isOnline, setIsOnline] = useState(navigator.onLine);
	const onlineRef = useRef(isOnline);

	useEffect(() => {
		const onOnline = () => {
			setIsOnline(true);
			if (!onlineRef.current) {
				toast.success("网络已恢复");
			}
			onlineRef.current = true;
		};
		const onOffline = () => {
			setIsOnline(false);
			if (onlineRef.current) {
				toast.warning("网络已断开");
			}
			onlineRef.current = false;
		};
		window.addEventListener("online", onOnline);
		window.addEventListener("offline", onOffline);
		return () => {
			window.removeEventListener("online", onOnline);
			window.removeEventListener("offline", onOffline);
		};
	}, []);

	return isOnline;
}

/** 受损的能力面 —— 网络断开影响全部通道；仅 WS 断开只影响服务端推送。 */
export type DegradedChannel = "none" | "realtime_push" | "all";

export interface TrainingConnectionState {
	isOnline: boolean;
	/** 训练 WebSocket（服务端推送通道）是否在线 */
	wsConnected: boolean;
	/** 实际受损的能力：`all` = 网络断开（对话/工具/提交都会失败）；`realtime_push` = 仅实时推送 */
	degraded: DegradedChannel;
}

/**
 * 训练页连接状态 —— `navigator.onLine` + 训练 WS 连接状态。
 *
 * 用于把「到底什么坏了」说清楚：WS 只推评分/状态通知，对话走 SSE、工具与提交走 HTTP，
 * 因此 WS 断开不能说成「工具不可用」（docs/19 E5）。WS 状态订阅是单例、立即回调一次。
 */
export function useTrainingConnection(): TrainingConnectionState {
	const isOnline = useNetworkStatus();
	const [wsConnected, setWsConnected] = useState(false);

	useEffect(() => subscribeWSConnection(setWsConnected), []);

	const degraded: DegradedChannel = !isOnline ? "all" : wsConnected ? "none" : "realtime_push";
	return { isOnline, wsConnected, degraded };
}
