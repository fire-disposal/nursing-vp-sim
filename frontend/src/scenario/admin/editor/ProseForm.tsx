/**
 * 编辑器「散文」页签：病例里**给人看的话**，四个小节与 `case.md` 一一对应。
 *
 * 纯文本域，没有语法可写错：
 * - 处境 → `brief`（一段话）
 * - 人物 → 每个在场者一段 `persona`（说话方式、在意什么）
 * - 真相 → `truth`（一条一段；它同时是防泄漏词表，所以一条里不能再有整行空白）
 * - 教师备注 → `teacher_notes`（写给自己与同事，不进学生视图、不进模型提示词）
 */

import { Stack, Textarea, TextInput } from "@mantine/core";
import type { ScenarioPackDoc, ScenarioPackProblem, ScenarioPackValue } from "@/api/scenario";
import { ListEditor, Section, StringListRow } from "./PackFormBits";
import { issuesOf } from "./sections";
import { listAt, setIn, textAt } from "./packDoc";

export default function ProseForm({
	doc,
	onChange,
	problems,
}: {
	doc: ScenarioPackDoc;
	onChange: (next: ScenarioPackDoc) => void;
	problems: ScenarioPackProblem[];
}) {
	return (
		<Stack gap="md">
			<Section
				id="brief"
				title="处境"
				hint="学生睁眼时在哪儿、什么时候、眼前是什么情况——一段话，直接写。"
				issues={issuesOf(problems, "brief")}
			>
				<Textarea
					label="处境"
					autosize
					minRows={4}
					value={textAt(doc, "brief")}
					onChange={(event) => onChange(setIn(doc, ["brief"], event.currentTarget.value))}
				/>
			</Section>

			<Section
				id="personas"
				title="人物"
				hint="每个在场者一段：他是个什么样的人、怎么说话、在意什么。学生会从语气里判断要不要再问下去。"
				issues={issuesOf(problems, "personas")}
			>
				<ListEditor
					items={listAt<ScenarioPackValue>(doc, "actors")}
					onChange={(value) => onChange(setIn(doc, ["actors"], value))}
					create={() => ({ id: `actor_${listAt<ScenarioPackValue>(doc, "actors").length + 1}`, role: "", presence: "on_site", demand: "neutral", knowledge: {}, persona: "" })}
					addLabel="添加人物"
					emptyText="还没有在场者（先在「表单」页签里加，这里就有段落可写）。"
					render={(_actor, index) => (
						<>
							<TextInput
								label="这个人的 id"
								description="人物本身（身份、接触方式、他知道什么）在「表单」页签里改"
								value={textAt(doc, "actors", index, "id")}
								onChange={(event) => onChange(setIn(doc, ["actors", index, "id"], event.currentTarget.value))}
							/>
							<Textarea
								label="他是怎样的人"
								autosize
								minRows={3}
								value={textAt(doc, "actors", index, "persona")}
								onChange={(event) =>
									onChange(setIn(doc, ["actors", index, "persona"], event.currentTarget.value))
								}
							/>
						</>
					)}
				/>
			</Section>

			<Section
				id="truth"
				title="真相"
				hint="学生看不到的真相：一条一段（段内不能有空行）。这一段同时是防泄漏词表——这里的说法一个字都不许出现在学生可见的文本里。"
				issues={issuesOf(problems, "truth")}
			>
				<StringListRow
					label="一条真相 = 一段"
					items={listAt<string>(doc, "truth")}
					onChange={(value) => onChange(setIn(doc, ["truth"], value))}
					addLabel="添加一条"
					emptyText="还没有写真相。"
					placeholder="如「深部痰栓堵住左侧气道，经口吸痰取不出来」"
				/>
			</Section>

			<Section
				id="teacher_notes"
				title="教师备注"
				hint="写给自己与同事：这个病例想让学生注意到什么、常见的走偏是哪几条。学生看不到。"
				issues={issuesOf(problems, "teacher_notes")}
			>
				<Textarea
					label="教师备注"
					autosize
					minRows={4}
					value={textAt(doc, "teacher_notes")}
					onChange={(event) => onChange(setIn(doc, ["teacher_notes"], event.currentTarget.value))}
				/>
			</Section>
		</Stack>
	);
}
