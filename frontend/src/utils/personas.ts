/**
 * 视角（Persona）—— 一组权限预设的代号。
 *
 * 后端把视角作为权限包：用户可被授予多个视角，请求头 `X-View-Persona` 选择当前生效的
 * 那一个（未授予 → 403）。前端只需要「有哪些、叫什么、怎么排序」，权限判定仍然走
 * `permissions`（由后端按当前视角算好），这里**不做权限推断**。
 */
export type PersonaId = "student" | "teacher" | "admin" | "ops" | "platform";

/** 侧栏/切换器的展示名（与后端预设一一对应，见 backend/core/personas.py）。 */
export const PERSONA_LABELS: Record<PersonaId, string> = {
	student: "学生",
	teacher: "教师",
	admin: "管理",
	ops: "运维",
	platform: "平台",
};

/** 展示顺序：从窄到宽（学生 → 教师 → 管理 → 运维）。 */
export const PERSONA_ORDER: PersonaId[] = ["student", "teacher", "admin", "ops", "platform"];

const PERSONA_IDS = new Set<string>(PERSONA_ORDER);

/** 只能属于平台账号、且作用域跨院校的视角（后端 `requires_platform_account`）。 */
const PLATFORM_ONLY_PERSONAS: Record<string, true> = { ops: true, platform: true };

export function isPersonaId(value: unknown): value is PersonaId {
	return typeof value === "string" && PERSONA_IDS.has(value);
}

export function isPlatformOnlyPersona(value: string | null | undefined): boolean {
	return value != null && PLATFORM_ONLY_PERSONAS[value] === true;
}

/**
 * 视角的展示名。未知取值（后端新增视角而前端未升级、或 legacy 自定义角色名）原样返回，
 * 不做兜底替换——把「某自定义角色」显示成「学生」会误导用户以为自己换了权限档。
 */
export function personaLabel(value: string | null | undefined): string | null {
	if (!value) return null;
	return isPersonaId(value) ? PERSONA_LABELS[value] : value;
}

/** 按 `PERSONA_ORDER` 排序（未知取值排最后，保持原相对顺序）。 */
export function sortPersonas(list: readonly string[]): string[] {
	const rank = (v: string) => {
		const i = PERSONA_ORDER.indexOf(v as PersonaId);
		return i === -1 ? PERSONA_ORDER.length : i;
	};
	return [...list].sort((a, b) => rank(a) - rank(b));
}
