import { describe, expect, it, vi } from "vitest";
import { openNotification } from "@/utils/training-nav";

describe("openNotification", () => {
	it("无进行中记录的新作业通知进入作业页，而不是训练首页", () => {
		const navigate = vi.fn();

		openNotification(navigate, { type: "assignment_new", record_id: null }, "/training");

		expect(navigate).toHaveBeenCalledWith("/assignments");
	});

	it("有进行中记录时优先继续原训练", () => {
		const navigate = vi.fn();

		openNotification(navigate, { type: "assignment_new", record_id: 42 }, "/cases");

		expect(navigate).toHaveBeenCalledWith("/training/42", {
			state: { from: "/cases" },
			replace: undefined,
		});
	});
});
