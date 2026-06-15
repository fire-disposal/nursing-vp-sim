import { useEffect, useState } from "react";
import { api } from "@/api/axios-instance";
import type { ManifestResponse } from "./types";

let cachedManifest: ManifestResponse | null = null;

async function fetchWithRetry(
	url: string,
	retries = 2,
): Promise<ManifestResponse> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const res = await api.get<ManifestResponse>(url);
			cachedManifest = res.data;
			return res.data;
		} catch (err) {
			lastError = err;
			if (attempt < retries) {
				await new Promise((r) =>
					setTimeout(r, Math.min(1000 * 2 ** attempt, 4000)),
				);
			}
		}
	}
	if (cachedManifest) return cachedManifest;
	throw lastError;
}

export async function fetchManifest(
	recordId?: string,
): Promise<ManifestResponse> {
	const url = recordId
		? `/training/${recordId}/plugins/manifest`
		: "/plugins/manifest";
	return fetchWithRetry(url);
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
				if (!cancelled && cachedManifest) {
					setManifest(cachedManifest);
				} else if (!cancelled) {
					setManifest(null);
				}
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
