import { Skeleton } from "@mantine/core";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { api } from "@/api/client";

interface AuthImageProps {
	src: string;
	alt?: string;
	className?: string;
	style?: CSSProperties;
}

/**
 * Loads an image from an API endpoint that requires auth (Bearer token).
 * Fetches via axios (which injects Authorization header), then renders via blob URL.
 */
export default function AuthImage({ src, alt = "", className, style }: AuthImageProps) {
	const [blobUrl, setBlobUrl] = useState<string | null>(null);
	const [error, setError] = useState(false);
	const [loading, setLoading] = useState(true);
	const prevSrcRef = useRef(src);
	const mountedRef = useRef(true);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const res = await api.get(src, { responseType: "blob" });
			if (!mountedRef.current) return;
			const url = URL.createObjectURL(res.data);
			setBlobUrl((prev) => {
				if (prev) URL.revokeObjectURL(prev);
				return url;
			});
		} catch {
			if (mountedRef.current) setError(true);
		} finally {
			if (mountedRef.current) setLoading(false);
		}
	}, [src]);

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
