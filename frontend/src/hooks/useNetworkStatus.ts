import { useEffect, useState } from "react";
import { useToast } from "@/components/Toast";

export function useNetworkStatus() {
	const [isOnline, setIsOnline] = useState(navigator.onLine);
	const toast = useToast();

	useEffect(() => {
		const onOnline = () => setIsOnline(true);
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
	}, [toast.warning]);

	return isOnline;
}
