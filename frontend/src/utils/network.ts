export function waitForOnline(timeoutMs = 120_000): Promise<void> {
	if (navigator.onLine) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error("等待网络恢复超时"));
		}, timeoutMs);
		const onOnline = () => {
			cleanup();
			resolve();
		};
		const cleanup = () => {
			clearTimeout(timer);
			window.removeEventListener("online", onOnline);
		};
		window.addEventListener("online", onOnline);
	});
}
