import type { AxiosResponse } from "axios";

/**
 * 从 `Content-Disposition` 取文件名（RFC 5987 `filename*=UTF-8''…` 与普通 `filename=` 都收）。
 * 服务端文件名带业务语义（如「成本明细.csv」），客户端不该用自造名字覆盖它。
 */
export function filenameFromDisposition(disposition: unknown): string | null {
	if (typeof disposition !== "string") return null;
	const star = /filename\*\s*=\s*([^;]+)/i.exec(disposition);
	if (star) {
		const raw = star[1].trim().replace(/^UTF-8''/i, "").replace(/^"|"$/g, "");
		try {
			return decodeURIComponent(raw);
		} catch {
			return raw;
		}
	}
	const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
	return plain ? plain[1].trim() : null;
}

/**
 * 下载一个 blob 响应：优先用服务端给的文件名，否则用 `fallback`。
 * 导出端点统一走这里，避免每个页面各写一遍 anchor 点击与 URL 回收。
 */
export function downloadBlobResponse(resp: AxiosResponse<Blob>, fallback: string): void {
	const filename = filenameFromDisposition(resp.headers["content-disposition"]) ?? fallback;
	const contentType = resp.headers["content-type"];
	const blob = new Blob([resp.data], {
		type: typeof contentType === "string" ? contentType : "application/octet-stream",
	});
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
}
