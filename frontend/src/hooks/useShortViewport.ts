import { HEIGHT } from "@/config/layout-scale";
import { useMediaQuery } from "./useMediaQuery";

/**
 * Detects short viewports (landscape phones, height < HEIGHT.shortViewport = 500px).
 * Used to hide bottom tab bar and compact top nav on devices
 * where vertical screen real estate is at a premium.
 */
export function useShortViewport(): boolean {
	return useMediaQuery(`(max-height: ${HEIGHT.shortViewport}px)`);
}
