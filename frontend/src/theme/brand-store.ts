import { create } from "zustand";
import { persist } from "zustand/middleware";
import { BRAND_PALETTES, DEFAULT_BRAND } from "./index";

const LEGACY_KEY = "vp-theme";

/** 兼容旧版裸字符串存储（useTheme 曾写入 localStorage["vp-theme"] = "teal"）。 */
function readLegacyBrand(): string {
	try {
		const raw = localStorage.getItem(LEGACY_KEY);
		if (raw && BRAND_PALETTES.some((p) => p.id === raw)) return raw;
	} catch {
		/* SSR/隐私模式 — 回退默认 */
	}
	return DEFAULT_BRAND;
}

interface BrandState {
	brand: string;
	setBrand: (brand: string) => void;
}

export const useBrandStore = create<BrandState>()(
	persist(
		(set) => ({
			brand: readLegacyBrand(),
			setBrand: (brand) => {
				if (BRAND_PALETTES.some((p) => p.id === brand)) set({ brand });
			},
		}),
		{ name: "vp-brand" },
	),
);
