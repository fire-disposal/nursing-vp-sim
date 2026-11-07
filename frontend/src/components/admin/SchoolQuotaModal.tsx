import { Button, Group, Modal, NumberInput, Progress, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import type { SchoolBudget } from "@/api/admin/budgets";
import { clearSchoolBudget, getSchoolBudgets, setSchoolBudget } from "@/api/admin/budgets";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/confirm";

const pct = (used: number, limit: number) => (limit > 0 ? Math.min(100, (used / limit) * 100) : 0);
const barColor = (value: number) => (value >= 90 ? "red" : value >= 70 ? "orange" : "blue");

/** 院校额度：月度 LLM/TTS 上限 + 给本校用户的默认日额度（留空继承平台默认）。 */
export default function SchoolQuotaModal({
	school,
	opened,
	onClose,
}: {
	school: { id: number; name: string } | null;
	opened: boolean;
	onClose: () => void;
}) {
	const toast = useToast();
	const { confirm } = useConfirm();
	const [data, setData] = useState<SchoolBudget | null>(null);
	const [llm, setLlm] = useState<number | string>(0);
	const [tts, setTts] = useState<number | string>(0);
	const [dailyLlm, setDailyLlm] = useState<number | string>("");
	const [dailyTts, setDailyTts] = useState<number | string>("");
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (!opened || !school) return;
		getSchoolBudgets()
			.then((r) => {
				const row = r.data.find((b) => b.school_id === school.id);
				setData(row ?? null);
				setLlm(row?.llm_monthly_limit ?? 0);
				setTts(row?.tts_monthly_limit ?? 0);
				setDailyLlm(row?.default_daily_llm_limit ?? "");
				setDailyTts(row?.default_daily_tts_limit ?? "");
			})
			.catch(() => toast.error("额度加载失败"));
	}, [opened, school]);

	const reset = async () => {
		if (!school) return;
		const ok = await confirm({ title: "清除院校额度", message: "清除后月度上限恢复不限，用户默认日额度回到平台默认。", danger: true });
		if (!ok) return;
		try {
			await clearSchoolBudget(school.id);
			toast.success("院校额度已清除");
			onClose();
		} catch {
			toast.error("清除失败");
		}
	};

	const save = async () => {
		if (!school) return;
		setSaving(true);
		try {
			const r = await setSchoolBudget(school.id, {
				llm_monthly_limit: Number(llm) || 0,
				tts_monthly_limit: Number(tts) || 0,
				default_daily_llm_limit: dailyLlm === "" ? null : Number(dailyLlm),
				default_daily_tts_limit: dailyTts === "" ? null : Number(dailyTts),
			});
			setData(r.data);
			toast.success("院校额度已保存");
			onClose();
		} catch {
			toast.error("保存失败");
		} finally {
			setSaving(false);
		}
	};

	return (
		<Modal opened={opened} onClose={onClose} title={`额度 · ${school?.name ?? ""}`} centered>
			<Stack gap="md">
				<Text size="xs" c="dimmed">
					月度上限约束全校；0 = 不限。默认日额度供本校未单独设置的用户继承，留空则继承平台默认。
				</Text>
				<Group grow>
					<NumberInput label="LLM 月度上限（元）" min={0} decimalScale={2} value={llm} onChange={setLlm} />
					<NumberInput label="TTS 月度上限（元）" min={0} decimalScale={2} value={tts} onChange={setTts} />
				</Group>
				{data && (
					<Stack gap={6}>
						<Text size="xs">
							LLM 本月已用 ¥{data.llm_used.toFixed(2)} / {data.llm_monthly_limit || "不限"}
							{data.llm_monthly_limit > 0 ? `（剩余 ¥${Math.max(0, data.llm_monthly_limit - data.llm_used).toFixed(2)}）` : ""}
						</Text>
						{data.llm_monthly_limit > 0 && (
							<Progress
								value={pct(data.llm_used, data.llm_monthly_limit)}
								size="sm"
								color={barColor(pct(data.llm_used, data.llm_monthly_limit))}
							/>
						)}
						<Text size="xs">
							TTS 本月已用 ¥{data.tts_used.toFixed(2)} / {data.tts_monthly_limit || "不限"}
							{data.tts_monthly_limit > 0 ? `（剩余 ¥${Math.max(0, data.tts_monthly_limit - data.tts_used).toFixed(2)}）` : ""}
						</Text>
						{data.tts_monthly_limit > 0 && (
							<Progress
								value={pct(data.tts_used, data.tts_monthly_limit)}
								size="sm"
								color={barColor(pct(data.tts_used, data.tts_monthly_limit))}
							/>
						)}
					</Stack>
				)}
				<Group grow>
					<NumberInput
						label="用户默认日额度 · LLM（元）"
						min={0}
						decimalScale={2}
						placeholder="继承平台"
						value={dailyLlm}
						onChange={setDailyLlm}
					/>
					<NumberInput
						label="用户默认日额度 · TTS（元）"
						min={0}
						decimalScale={2}
						placeholder="继承平台"
						value={dailyTts}
						onChange={setDailyTts}
					/>
				</Group>
				<Group justify="space-between">
					<Button variant="subtle" color="red" onClick={reset}>
						清除院校设置
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
