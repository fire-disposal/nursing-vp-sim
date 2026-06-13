import { useEffect, useState } from "react";
import { useToast } from "@/components/Toast";

export function useNetworkStatus() {
	const [isOnline, setIsOnline] = useState(navigator.onLine);
	const toast = useToast();

	useEffect(() => {
		const onOnline = () => {
			setIsOnline(true);
			toast.success("网络已恢复");
		};
		const onOffline = () => {
			setIsOnline(false);
			toast.warning("网络已断开");
		};
		window.addEventListener("online", onOnline);
		window.addEventListener("offline", onOffline);
		return () => {
			window.removeEventListener("online", onOnline);
			window.removeEventListener("offline", onOffline);
		};
	}, [toast.warning, toast.success]);

	return isOnline;
}
