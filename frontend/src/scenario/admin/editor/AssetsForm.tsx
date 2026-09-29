/**
 * 编辑器「图片」页签：声明与字节在**一处**管完。
 *
 * 分工（与后端一致）：
 * - **声明**（id / 标题 / 替代文本 / 什么时候可以展示 `reveal_with`）跟着当前内容走，
 *   由编辑器的「保存」落库——所以它能引用线索 id，是作者读得懂的那一半；
 * - **字节**走资源端点（上传/替换/删除），一次改一版当前内容。
 *
 * 字节操作读的是**已保存**的那份内容，所以草稿有改动时它们先禁用（否则刚改的声明会被覆盖掉）：
 * 先把声明存下来，再传字节。
 */

import {
	Alert,
	Badge,
	Button,
	Code,
	Group,
	Modal,
	FileInput,
	MultiSelect,
	Stack,
	Text,
	TextInput,
	Tooltip,
} from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { queryKeys } from "@/api/query-keys";
import {
	deleteAdminScenarioAsset,
	type ScenarioAdminPack,
	type ScenarioAssetReplaceInput,
	type ScenarioAssetUploadInput,
	replaceAdminScenarioAsset,
	type ScenarioPackDoc,
	type ScenarioPackProblem,
	type ScenarioPackValue,
	uploadAdminScenarioAsset,
} from "@/api/scenario";
import { toast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";
import { getApiErrorDetail } from "@/utils/error";
import { ListEditor, refOptions, Section } from "./PackFormBits";
import { issuesOf } from "./sections";
import { listAt, removeAt, setIn, textAt } from "./packDoc";

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

export default function AssetsForm({
	doc,
	onChange,
	problems,
	pack,
	dirty,
}: {
	doc: ScenarioPackDoc;
	onChange: (next: ScenarioPackDoc) => void;
	problems: ScenarioPackProblem[];
	pack: ScenarioAdminPack;
	dirty: boolean;
}) {
	const refs = refOptions(doc);
	const { confirm } = useConfirm();
	const queryClient = useQueryClient();
	/** 正在传字节的那张图（`replace` = 它已经有字节了，走替换）。 */
	const [draft, setDraft] = useState<{ id: string; replace: boolean } | null>(null);
	const [file, setFile] = useState<File | null>(null);
	const assets = pack.assets ?? [];
	const stored = (id: string) => assets.find((asset) => asset.id === id);

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: queryKeys.scenario.admin.all });

	const uploadMutation = useMutation({
		mutationFn: (payload: ScenarioAssetUploadInput) =>
			uploadAdminScenarioAsset(pack.key, payload),
		onSuccess: (data) => {
			toast.success(`${data.asset.id}：图片已保存`, {
				description: "这一版内容里这张图有字节了；正在进行的会话按编号取到的也是它。",
			});
			setDraft(null);
			setFile(null);
			void invalidate();
		},
		onError: (error) => toast.error(getApiErrorDetail(error, "上传图片失败")),
	});

	const replaceMutation = useMutation({
		mutationFn: ({ assetId, payload }: { assetId: string; payload: ScenarioAssetReplaceInput }) =>
			replaceAdminScenarioAsset(pack.key, assetId, payload),
		onSuccess: (data) => {
			toast.success(`${data.asset.id}：已换成新图`, {
				description: "编号没变，内容里的引用不用改；图按编号只存一份。",
			});
			setDraft(null);
			setFile(null);
			void invalidate();
		},
		onError: (error) => toast.error(getApiErrorDetail(error, "替换图片失败")),
	});

	const deleteMutation = useMutation({
		mutationFn: (assetId: string) => deleteAdminScenarioAsset(pack.key, assetId),
		onSuccess: (data, assetId) => {
			const index = listAt<ScenarioPackValue>(doc, "assets").findIndex(
				(_item, position) => textAt(doc, "assets", position, "id") === assetId,
			);
			if (index >= 0) onChange(setIn(doc, ["assets"], removeAt(listAt(doc, "assets"), index)));
			toast.success(`${assetId}：已删除`, {
				description: `声明已从病例里去掉（现在是版本 #${data.version}），字节也一并删了。`,
			});
			void invalidate();
		},
		onError: (error) => toast.error(getApiErrorDetail(error, "删除图片失败")),
	});

	const askDelete = async (assetId: string, title: string) => {
		const ok = await confirm({
			title: `删除 ${assetId}？`,
			message: `删除后病例里不再有「${title || assetId}」，字节也从库里删掉。正在进行的会话仍用它们开始时的内容。`,
			confirmLabel: "确认删除",
			danger: true,
		});
		if (ok) deleteMutation.mutate(assetId);
	};

	const submitBytes = () => {
		if (draft === null || file === null) return;
		const index = listAt<ScenarioPackValue>(doc, "assets").findIndex(
			(_item, position) => textAt(doc, "assets", position, "id") === draft.id,
		);
		const payload = {
			file,
			title: index >= 0 ? textAt(doc, "assets", index, "title") : "",
			alt: index >= 0 ? textAt(doc, "assets", index, "alt") : "",
		};
		if (draft.replace) replaceMutation.mutate({ assetId: draft.id, payload });
		else uploadMutation.mutate({ asset_id: draft.id, ...payload });
	};

	const busy = uploadMutation.isPending || replaceMutation.isPending;

	return (
		<Section
			id="assets"
			title="图片"
			hint="声明（编号、标题、替代文本、什么时候可以展示）跟着这一版内容保存；字节用每行的「上传 / 换一张」传。"
			issues={issuesOf(problems, "assets")}
		>
			<Stack gap="sm">
				<Text size="xs" c="dimmed">
					声明里写下的编号就是别处引用它的写法；替代文本必填（看不到图的人也读得懂）。
					「什么时候可以展示」从已声明的线索里选：至少一条被揭示之后，这张图才允许出示。
				</Text>
				{dirty && (
					<Alert color="orange" variant="light" icon={<IconAlertTriangle size={16} />}>
						表格里还有未保存的声明改动。字节会挂到**已保存**的那一版上，所以先点「保存」再传图。
					</Alert>
				)}

				<ListEditor
					items={listAt<ScenarioPackValue>(doc, "assets")}
					onChange={(value) => onChange(setIn(doc, ["assets"], value))}
					create={() => ({
						id: `a_new_${listAt<ScenarioPackValue>(doc, "assets").length + 1}`,
						kind: "image",
						title: "",
						alt: "",
						reveal_with: [],
					})}
					addLabel="添加图片声明"
					emptyText="还没有声明任何图片。"
					render={(_asset, index) => {
						const id = textAt(doc, "assets", index, "id");
						const live = stored(id);
						return (
							<>
								<Group grow align="flex-start">
									<TextInput
										label="编号"
										description="别处就用它引用这张图"
										value={id}
										onChange={(event) => onChange(setIn(doc, ["assets", index, "id"], event.currentTarget.value))}
									/>
									<TextInput
										label="标题"
										value={textAt(doc, "assets", index, "title")}
										onChange={(event) => onChange(setIn(doc, ["assets", index, "title"], event.currentTarget.value))}
									/>
									<TextInput
										label="替代文本"
										description="看不到图的人读到的描述（必填）"
										value={textAt(doc, "assets", index, "alt")}
										onChange={(event) => onChange(setIn(doc, ["assets", index, "alt"], event.currentTarget.value))}
									/>
								</Group>
								<MultiSelect
									label="什么时候可以展示（这些线索里至少一条被揭示）"
									data={refs.cues}
									searchable
									value={listAt<string>(doc, "assets", index, "reveal_with")}
									onChange={(value) => onChange(setIn(doc, ["assets", index, "reveal_with"], value))}
								/>
								<Group gap="xs" align="center" wrap="wrap">
									{live?.uploaded ? (
										<Badge color="green" variant="light">
											已上传
										</Badge>
									) : (
										<Badge color="orange" variant="light">
											未上传
										</Badge>
									)}
									<Text size="xs" c="dimmed">
										{live?.filename ? <Code>{live.filename}</Code> : "库里还没有这张图的字节"}
									</Text>
									<Tooltip
										label={dirty ? "先保存声明，再传字节" : ""}
										disabled={!dirty}
										withArrow
									>
										<Button
											size="compact-sm"
											variant="light"
											disabled={dirty || id === ""}
											loading={busy && draft?.id === id}
											onClick={() => {
												setFile(null);
												setDraft({ id, replace: live?.uploaded === true });
											}}
										>
											{live?.uploaded ? "换一张" : "上传字节"}
										</Button>
									</Tooltip>
									<Button
										size="compact-sm"
										variant="subtle"
										color="red"
										disabled={id === ""}
										onClick={() => void askDelete(id, textAt(doc, "assets", index, "title"))}
									>
										删除这张图
									</Button>
								</Group>
							</>
						);
					}}
				/>

				<Text size="xs" c="dimmed">
					支持 PNG / JPEG / WebP / GIF，单张上限 8&nbsp;MB；保存时会统一转成 WebP 并去掉照片自带的拍摄信息。
				</Text>
				<Text size="xs" c="dimmed">
					声明的 `file` 由上传写入，不用手填。
				</Text>
			</Stack>

			<Modal
				opened={draft !== null}
				onClose={() => setDraft(null)}
				title={draft?.replace ? `换一张：${draft.id}` : `上传字节：${draft?.id ?? ""}`}
				centered
			>
				<Stack gap="sm">
					<FileInput
						label="图片文件"
						placeholder="选择图片"
						accept={IMAGE_ACCEPT}
						value={file}
						onChange={setFile}
						required
					/>
					<Group justify="flex-end" gap="sm">
						<Button variant="default" onClick={() => setDraft(null)}>
							取消
						</Button>
						<Button disabled={file === null} loading={busy} onClick={submitBytes}>
							{draft?.replace ? "保存" : "上传"}
						</Button>
					</Group>
				</Stack>
			</Modal>
		</Section>
	);
}
