/**
 * 编辑器「原始」页签读原文用的那一小段 zip 读取：**只读文本成员**，认后端会产出的那一种包。
 *
 * 夹具（`fixtures.caseZipBlob`）是后端 `case_folder.zip_bytes` 的同形产物，所以这里钉的是
 * "真能解出 `case.toml` / `case.md`"，而不是一个自造的假包。
 */

import { describe, expect, it } from "vitest";
import { zipTextMembers } from "@/scenario/admin/editor/zipMembers";
import { caseZipBlob } from "./fixtures";

describe("从导出 zip 里读原文", () => {
	it("成员名带一层病例根目录也能按名字取到（文本解压正确）", async () => {
		const members = await zipTextMembers(caseZipBlob(), ["case.toml", "case.md"]);
		expect(members["case.toml"]).toBe('key = "demo"\ntitle = "演示"\n');
		expect(members["case.md"]).toBe("## 处境\n\n夜班。\n");
	});

	it("只要点名的成员（包里的其它文件不进结果）", async () => {
		const members = await zipTextMembers(caseZipBlob(), ["img/other.png", "case.toml"]);
		expect(Object.keys(members)).toEqual(["case.toml"]);
	});

	it("名字不存在时如实留空，由调用方说明" , async () => {
		const members = await zipTextMembers(caseZipBlob(), ["case.yml"]);
		expect(members).toEqual({});
	});

	it("不是 zip 的字节：报错，不当成空包", async () => {
		await expect(zipTextMembers(new Blob([new Uint8Array([1, 2, 3])]), ["case.toml"])).rejects.toThrow(
			/不是合法的 zip/,
		);
	});
});
