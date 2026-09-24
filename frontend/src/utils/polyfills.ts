/**
 * 浏览器下限垫片 —— 必须是入口的第一条 import（见 main.tsx）。
 *
 * ESM 会先求值被 import 的模块，所以只有放到独立模块并在 main.tsx 首行引入，
 * 才能保证垫片早于 React/Mantine/懒加载 chunk 里的任何代码执行。
 *
 * 为什么需要：机房镜像停在 Chromium 92（Edge 92 / Chrome 92），而
 * - `Object.hasOwn` 需要 Chromium 93 / Firefox 92 / Safari 15.4。缺失时
 *   react-markdown（markdown chunk）在渲染期直接抛 TypeError，被 ErrorBoundary
 *   整页接管（2026-09-24 机房测试事故）；recharts（charts chunk）与
 *   TrainingEngine 的 v2 情绪回退分支是同类未爆点。
 * - `crypto.randomUUID` 需要 Chromium 92 / Firefox 95 / Safari 15.4，训练会话的
 *   消息 id 依赖它（trainingStore / useToolBridge）。
 * 这些都是内置 API，打包器只会降级语法、不会补 API，只能显式垫片。
 * 浏览器下限与残留风险见 docs/09-operations.md「浏览器下限」。
 */

if (typeof Object.hasOwn !== "function") {
	Object.defineProperty(Object, "hasOwn", {
		value: function hasOwn(target: object, key: PropertyKey): boolean {
			if (target === null || target === undefined) {
				throw new TypeError("Cannot convert undefined or null to object");
			}
			// 与规范一致：ToObject(target) + HasOwnProperty，原型链上的属性不算。
			// biome-ignore lint/suspicious/noPrototypeBuiltins: 垫片本体只能走原型方法，用 Object.hasOwn 会自引用。
			return Object.prototype.hasOwnProperty.call(Object(target), key);
		},
		writable: true,
		configurable: true,
	});
}

if (typeof crypto !== "undefined" && typeof crypto.randomUUID !== "function") {
	const randomUUID = (): string => {
		// RFC 4122 v4：随机 16 字节 + 版本/变体位。
		const bytes = crypto.getRandomValues(new Uint8Array(16));
		bytes[6] = (bytes[6] & 0x0f) | 0x40;
		bytes[8] = (bytes[8] & 0x3f) | 0x80;
		const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	};
	Object.defineProperty(crypto, "randomUUID", {
		value: randomUUID,
		writable: true,
		configurable: true,
	});
}
