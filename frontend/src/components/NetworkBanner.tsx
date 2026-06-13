import { WifiOff } from "lucide-react";

export function NetworkBanner() {
	return (
		<div className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-white shrink-0">
			<WifiOff size={14} />
			网络已断开，部分功能不可用
		</div>
	);
}
