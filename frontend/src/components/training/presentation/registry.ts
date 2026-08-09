import type { PatientPresenter, PresentationKind } from "./types";
import { pngVariantPresenter } from "./presenters/pngVariant";
import { realisticAvatarPresenter } from "./presenters/realisticAvatar";
import { staticAvatarPresenter } from "./presenters/staticAvatar";
import { svgFacePresenter } from "./presenters/svgFace";
import { videoSchedulerPresenter } from "./presenters/videoScheduler";

/**
 * 呈现器注册表 — 单一分发点。
 * 新增策略：在 presenters/ 下按同一范式写模块，在此注册一行即可。
 */
export const PRESENTERS: Record<PresentationKind, PatientPresenter> = {
	static: staticAvatarPresenter,
	realistic: realisticAvatarPresenter,
	"png-variant": pngVariantPresenter,
	svg: svgFacePresenter,
	video: videoSchedulerPresenter,
};
