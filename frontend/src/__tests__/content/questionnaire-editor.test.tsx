import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "../render";
import QuestionnaireEditor from "@/components/admin/questionnaires/QuestionnaireEditor";
import QuestionnairesTab from "@/components/admin/QuestionnairesTab";
import { emptyForm, type TemplateForm } from "@/components/admin/questionnaires/types";
import type * as questionnairesApi from "@/api/questionnaires";

const getTemplatesMock = vi.hoisted(() => vi.fn());
vi.mock("@/api/questionnaires", async (importOriginal) => {
	const actual = await importOriginal<typeof questionnairesApi>();
	return { ...actual, getQuestionnairesTemplates: getTemplatesMock };
});

function EditorHost() {
	const [form, setForm] = useState<TemplateForm>(emptyForm());
	return (
		<QuestionnaireEditor
			open
			editingId={null}
			form={form}
			editMsg=""
			isLoadingDetail={false}
			isSaving={false}
			onClose={vi.fn()}
			onSave={vi.fn()}
			setForm={setForm}
		/>
	);
}

describe("问卷编辑器", () => {
	it("空模板可添加题目并填写内容", async () => {
		const user = userEvent.setup();
		render(<EditorHost />);
		await user.click(screen.getByRole("button", { name: "添加题目" }));
		expect(screen.getByText("第 1 题")).toBeInTheDocument();
		await user.type(screen.getByPlaceholderText("题目内容"), "本次训练是否帮助你识别关键线索？");
		expect(screen.getByDisplayValue("本次训练是否帮助你识别关键线索？")).toBeInTheDocument();
	});

	it("问卷管理页新建后可添加题目，不触发整页错误", async () => {
		getTemplatesMock.mockResolvedValue({ data: { items: [], total: 0, offset: 0, limit: 20 } });
		const user = userEvent.setup();
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		render(
			<QueryClientProvider client={client}>
				<MemoryRouter><QuestionnairesTab /></MemoryRouter>
			</QueryClientProvider>,
		);
		await user.click(screen.getByRole("button", { name: "新建问卷" }));
		await user.type(screen.getByRole("textbox", { name: /标题/ }), "体验验证问卷");
		await user.click(screen.getByRole("button", { name: "添加题目" }));
		expect(screen.getByText("第 1 题")).toBeInTheDocument();
		expect(screen.queryByText("页面出错了")).not.toBeInTheDocument();
	});
});

