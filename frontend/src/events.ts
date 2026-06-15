const FORCE_LOGOUT = "app:force-logout";

export function dispatchForceLogout() {
	window.dispatchEvent(new CustomEvent(FORCE_LOGOUT));
}

export function onForceLogout(handler: () => void) {
	const cb = () => handler();
	window.addEventListener(FORCE_LOGOUT, cb);
	return () => window.removeEventListener(FORCE_LOGOUT, cb);
}
