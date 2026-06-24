import { useEffect, useRef, useState } from "react";
import { toast } from "@/components/Toast";

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
