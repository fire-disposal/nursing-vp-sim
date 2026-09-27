/**
 * 头像由前端从 `avatar_seed` 派生：稳定哈希 → 取色 + 取首字。
 *
 * 后端不提供头像图片（`avatar_seed` 是声明角色 = actor id，临时角色 = DM 写的显示名），
 * 所以这里只用纯函数换算：同一个 seed 在任何设备、任何回合都得到同一个颜色与同一个字，
 * 不用 emoji、不用随机图、不依赖网络。
 */
export interface ScenarioAvatar {
	color: string;
	initials: string;
}

/** FNV-1a 32 位：短字符串上分布够均匀，且完全可复现（不依赖语言内置 hash）。 */
function seedHash(key: string): number {
	let hash = 2166136261;
	for (const char of key) {
		hash ^= char.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 16777619);
	}
	return Math.abs(hash);
}

/**
 * 头像 = 颜色 + 首字。
 *
 * - 颜色只由 `seed` 决定（声明角色 = actor id，临时角色 = 显示名），
 *   所以同一个角色在整场会话里颜色恒定，与它叫不叫得上名字无关；
 * - 首字取自**学生读到的那个名字**（`label`），没有名字时退回 seed
 *   （声明角色的 id 是英文 slug，直接取首字母会得到 "PA" 这种读不出来的标记）。
 */
export function avatarFor(seed: string, label: string = seed): ScenarioAvatar {
	const key = seed.trim();
	if (key.length === 0) {
		return { color: "hsl(200 12% 55%)", initials: "人" };
	}
	const hash = seedHash(key);
	// hue 只有 360 档，单靠它在短名字里撞色（实测 doctor/nurse_aide 撞过）；
	// 再取 hash 的高位微调明度/饱和度，撞色概率降到可忽略。
	const hue = hash % 360;
	const saturation = 42 + ((hash >>> 11) % 14);
	const lightness = 58 + ((hash >>> 21) % 10);
	const name = label.trim() || key;
	// 拉丁名取开头的两个字母（"A 床患者" → "A"，"patient" → "PA"）；中文取首字
	const latin = /^[A-Za-z]+/.exec(name)?.[0];
	const initials = latin ? latin.slice(0, 2).toUpperCase() : [...name][0];
	return { color: `hsl(${hue} ${saturation}% ${lightness}%)`, initials };
}
