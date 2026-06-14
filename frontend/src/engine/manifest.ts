import { useEffect, useState } from "react";
import { api } from "@/api/axios-instance";
import type { ManifestResponse } from "./types";

let cachedManifest: ManifestResponse | null = null;

export async function fetchManifest(
	recordId?: string,
): Promise<ManifestResponse> {
	const url = recordId
		? `/training/${recordId}/plugins/manifest`
		: "/plugins/manifest";

	const res = await api.get<ManifestResponse>(url);
	cachedManifest = res.data;
	return res.data;
}

export function useManifest(recordId?: string) {
	const [manifest, setManifest] = useState<ManifestResponse | null>(
		cachedManifest,
	);
	const [loading, setLoading] = useState(!cachedManifest);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		fetchManifest(recordId)
			.then((m) => {
				if (!cancelled) setManifest(m);
			})
			.catch(() => {
				if (!cancelled) setManifest(null);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [recordId]);

	return { manifest, loading };
}
