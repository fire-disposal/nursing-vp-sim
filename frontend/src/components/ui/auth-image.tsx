import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api/client";

interface AuthImageProps {
	src: string;
	alt?: string;
	className?: string;
}

/**
 * Loads an image from an API endpoint that requires auth (Bearer token).
 * Fetches via axios (which injects Authorization header), then renders via blob URL.
 */
export default function AuthImage({ src, alt = "", className }: AuthImageProps) {
	const [blobUrl, setBlobUrl] = useState<string | null>(null);
	const [error, setError] = useState(false);
	const mountedRef = useRef(true);

	const load = useCallback(async () => {
		try {
			const res = await api.get(src, { responseType: "blob" });
			if (mountedRef.current) {
				setBlobUrl(URL.createObjectURL(res.data));
			}
		} catch {
			if (mountedRef.current) setError(true);
		}
	}, [src]);

	useEffect(() => {
		mountedRef.current = true;
		setBlobUrl(null);
		setError(false);
		load();
		return () => {
			mountedRef.current = false;
		};
	}, [load]);

	if (error) return null;
	if (!blobUrl) return <div className={`bg-muted animate-pulse rounded ${className ?? ""}`} />;

	return <img src={blobUrl} alt={alt} className={className} />;
}
