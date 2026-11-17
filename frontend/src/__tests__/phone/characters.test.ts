import { describe, expect, it } from "vitest";
import { characterFacts, findCharacter, PHONE_CHARACTERS } from "@/engine/phone/characters";
import { dominantLabel } from "@/engine/phone/emotion";

/**
 * 角色卡：四个人必须真的"不像同一个人" —— 否则演示页就只是四张重名卡。
 * 断言的是**差异**（性别/年龄/脾气/音色/配色/初始向量），不是具体文案。
 */
describe("演示电话角色卡", () => {
	it("四个角色，id 唯一且都能查回", () => {
		expect(PHONE_CHARACTERS).toHaveLength(4);
		const ids = new Set(PHONE_CHARACTERS.map((c) => c.id));
		expect(ids.size).toBe(4);
		for (const c of PHONE_CHARACTERS) expect(findCharacter(c.id)).toBe(c);
		expect(findCharacter("nobody")).toBeNull();
		expect(findCharacter(null)).toBeNull();
	});

	it("性别与年龄都不同：没有两个人共用一档人设", () => {
		expect(new Set(PHONE_CHARACTERS.map((c) => c.gender)).size).toBe(2);
		expect(new Set(PHONE_CHARACTERS.map((c) => c.age)).size).toBe(4);
		expect(new Set(PHONE_CHARACTERS.map((c) => c.temperament)).size).toBe(4);
		expect(new Set(PHONE_CHARACTERS.map((c) => c.voice)).size).toBe(4);
	});

	it("四个角色使用不同的 TTS 2.0 音色", () => {
		const speakers = PHONE_CHARACTERS.map((c) => c.speaker);
		expect(new Set(speakers).size).toBe(4);
		for (const speaker of speakers) expect(speaker).toMatch(/_uranus_bigtts$/);
	});

	it("配色两两不同（主色与人物色都要能区分）", () => {
		expect(new Set(PHONE_CHARACTERS.map((c) => c.palette.primary)).size).toBe(4);
		expect(new Set(PHONE_CHARACTERS.map((c) => c.palette.hair)).size).toBe(4);
	});

	it("初始四维向量互不相同，且主导标签合理", () => {
		const vectors = PHONE_CHARACTERS.map((c) =>
			[c.initial.trust, c.initial.anxiety, c.initial.irritation, c.initial.cooperation].join(","),
		);
		expect(new Set(vectors).size).toBe(4);
		// 何剑峰是唯一开局就烦躁的人；苏小满开局最焦虑。
		expect(dominantLabel(findCharacter("he-jianfeng")!.initial)).toBe("defensive");
		expect(dominantLabel(findCharacter("su-xiaoman")!.initial)).toBe("anxious_cooperative");
	});

	it("卡片元信息不含任何评分/训练语义", () => {
		const banned = /分|评分|得分|训练|难度|病例|主诉/;
		for (const c of PHONE_CHARACTERS) {
			const text = [c.name, c.temperament, c.callAbout, c.voice, ...characterFacts(c)].join(" ");
			expect(banned.test(text)).toBe(false);
		}
	});
});
