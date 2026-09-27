import { Skeleton } from "@mantine/core";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";

interface AuthImageProps {
	src: string;
	alt?: string;
	className?: string;
	style?: CSSProperties;
	/**
	 * 加载状态回调（可选）：调用方据此**在失败时不留占位**（例如场景缩略图条）。
	 * 只在状态真的变化时回调，不参与渲染。
	 */
	onStatus?: (status: AuthImageStatus) => void;
}

export type AuthImageStatus = "loading" | "loaded" | "error";

/**
 * Loads an image from an API endpoint that requires auth (Bearer token).
 * Fetches via axios (which injects Authorization header), then renders via blob URL.
 */
export default function AuthImage({
	src,
	alt = "",
	className,
	style,
	onStatus,
}: AuthImageProps) {
	const statusRef = useRef<AuthImageStatus | null>(null);
	const [blobUrl, setBlobUrl] = useState<string | null>(null);
	const [error, setError] = useState(false);
	const [loading, setLoading] = useState(true);
	const prevSrcRef = useRef(src);
	const mountedRef = useRef(true);

	const report = useCallback(
		(status: AuthImageStatus) => {
			if (statusRef.current === status) return;
			statusRef.current = status;
			onStatus?.(status);
		},
		[onStatus],
	);

	const load = useCallback(async () => {
		setLoading(true);
		report("loading");
		try {
			const res = await api.get(src, { responseType: "blob" });
			if (!mountedRef.current) return;
			const url = URL.createObjectURL(res.data);
			setBlobUrl((prev) => {
				if (prev) URL.revokeObjectURL(prev);
				return url;
			});
			report("loaded");
		} catch {
			if (mountedRef.current) {
				setError(true);
				report("error");
			}
		} finally {
			if (mountedRef.current) setLoading(false);
		}
	}, [src, report]);

	useEffect(() => {
		mountedRef.current = true;
		const srcChanged = prevSrcRef.current !== src;
		prevSrcRef.current = src;

		if (srcChanged) {
			setBlobUrl(null);
			setError(false);
		}
		load();

		return () => {
			mountedRef.current = false;
		};
	}, [load, src]);

	useEffect(() => {
		return () => {
			setBlobUrl((prev) => {
				if (prev) URL.revokeObjectURL(prev);
				return null;
			});
		};
	}, []);

	if (error) return null;
	if (loading && !blobUrl) return <Skeleton radius="md" className={className} style={style} />;
	if (!blobUrl) return null;

	return <img src={blobUrl} alt={alt} className={className} style={style} />;
}
