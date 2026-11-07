import { Button, Group, Modal, NumberInput, Progress, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import type { UserBudget } from "@/api/admin/budgets";
import { clearUserBudget, getUserBudgets, setUserBudget } from "@/api/admin/budgets";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";

const SOURCE_LABEL: Record<string, string> = {
	user: "个人设置",
	school: "院校默认",
	platform: "平台默认",
};

/** 用户日额度：日刷新；个人设置 > 院校默认 > 平台默认。院校管理员可设置本校用户。 */
export default function UserQuotaModal({
	user,
	opened,
	onClose,
}: {
	user: { id: number; username: string; display_name: string } | null;
	opened: boolean;
	onClose: () => void;
}) {
	const toast = useToast();
	const { confirm } = useConfirm();
	const [data, setData] = useState<UserBudget | null>(null);
	const [llm, setLlm] = useState<number | string>(0);
	const [tts, setTts] = useState<number | string>(0);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (!opened || !user) return;
		getUserBudgets({ search: user.username, limit: 10 })
			.then((r) => {
				const row = r.data.find((b) => b.user_id === user.id);
				setData(row ?? null);
				setLlm(row?.daily_llm_limit ?? 0);
				setTts(row?.daily_tts_limit ?? 0);
			})
			.catch(() => toast.error("额度加载失败"));
	}, [opened, user]);

	const reset = async () => {
		if (!user) return;
		const ok = await confirm({ title: "恢复继承", message: "清除个人额度后，该用户回到院校默认 → 平台默认。", danger: true });
		if (!ok) return;
		try {
			await clearUserBudget(user.id);
			toast.success("已恢复继承");
			onClose();
		} catch {
			toast.error("清除失败");
		}
	};

	const save = async () => {
		if (!user) return;
		setSaving(true);
		try {
			const r = await setUserBudget(user.id, { llm_limit: Number(llm) || 0, tts_limit: Number(tts) || 0 });
			setData(r.data);
			toast.success("用户额度已保存");
			onClose();
		} catch {
			toast.error("保存失败");
		} finally {
			setSaving(false);
		}
	};

	const progress = (used: number, limit: number) => (limit > 0 ? Math.min(100, (used / limit) * 100) : 0);
const barColor = (value: number) => (value >= 90 ? "red" : value >= 70 ? "orange" : "blue");

	return (
		<Modal opened={opened} onClose={onClose} title={`日额度 · ${user?.display_name ?? ""}`} centered>
			<Stack gap="md">
				<Text size="xs" c="dimmed">
					每日刷新（北京时间零点）；0 = 不限。个人设置优先于院校默认，院校默认优先于平台默认。
					{data ? ` 当前来源：${SOURCE_LABEL[data.source] ?? data.source}。` : ""}
				</Text>
				{data && (
					<Stack gap={6}>
						<Text size="xs">
							LLM 今日已用 ¥{data.llm_used_today.toFixed(2)} / {data.daily_llm_limit || "不限"}
							{data.daily_llm_limit > 0 ? `（剩余 ¥${Math.max(0, data.daily_llm_limit - data.llm_used_today).toFixed(2)}）` : ""}
						</Text>
						{data.daily_llm_limit > 0 && (
							<Progress
								value={progress(data.llm_used_today, data.daily_llm_limit)}
								size="sm"
								color={barColor(progress(data.llm_used_today, data.daily_llm_limit))}
							/>
						)}
						<Text size="xs">
							TTS 今日已用 ¥{data.tts_used_today.toFixed(2)} / {data.daily_tts_limit || "不限"}
							{data.daily_tts_limit > 0 ? `（剩余 ¥${Math.max(0, data.daily_tts_limit - data.tts_used_today).toFixed(2)}）` : ""}
						</Text>
						{data.daily_tts_limit > 0 && (
							<Progress
								value={progress(data.tts_used_today, data.daily_tts_limit)}
								size="sm"
								color={barColor(progress(data.tts_used_today, data.daily_tts_limit))}
							/>
						)}
						{data.school_name && (
							<>
								<Text size="xs" c="dimmed">
									院校月度上限（{data.school_name}）：LLM ¥{data.school_llm_used.toFixed(2)} / {data.school_llm_limit || "不限"} · TTS ¥
									{data.school_tts_used.toFixed(2)} / {data.school_tts_limit || "不限"}
								</Text>
								{data.school_llm_limit > 0 && (
									<Progress
										value={progress(data.school_llm_used, data.school_llm_limit)}
										size="xs"
										color={barColor(progress(data.school_llm_used, data.school_llm_limit))}
									/>
								)}
							</>
						)}
					</Stack>
				)}
				<Group grow>
					<NumberInput label="LLM 日上限（元）" min={0} decimalScale={2} value={llm} onChange={setLlm} />
					<NumberInput label="TTS 日上限（元）" min={0} decimalScale={2} value={tts} onChange={setTts} />
				</Group>
				<Group justify="space-between">
					<Button variant="subtle" color="red" onClick={reset}>
						恢复继承
					</Button>
					<Group>
					<Button variant="default" onClick={onClose}>
						取消
					</Button>
					<Button loading={saving} onClick={save}>
						保存
					</Button>
					</Group>
				</Group>
			</Stack>
		</Modal>
	);
}
