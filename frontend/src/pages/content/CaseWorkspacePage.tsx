import { useParams, useSearchParams } from "react-router-dom";
import CaseFormPage from "@/components/admin/cases/CaseForm";
import NotFound from "@/pages/share/NotFound";

/** 地址里的病例 id → number；非法值（`/admin/cases/abc`）当作路径不存在。 */
function parseCaseId(raw: string | undefined): number | "new" | "invalid" {
	if (raw == null || raw === "") return "new";
	if (!/^\d+$/.test(raw)) return "invalid";
	const n = Number(raw);
	return Number.isSafeInteger(n) && n > 0 ? n : "invalid";
}

/**
 * 病例工作台路由页：`/admin/cases/new`（新建，`?mode=ai` 直接开 AI 面板）
 * 与 `/admin/cases/:caseId`（编辑，刷新可恢复）。
 *
 * 病例 id 只从地址栏取：工作台没有"当前选中的病例"这种隐式状态，
 * 深链、刷新、前进后退都指向同一份病例。
 */
export default function CaseWorkspacePage() {
	const { caseId: rawCaseId } = useParams<{ caseId: string }>();
	const [searchParams] = useSearchParams();
	const parsed = parseCaseId(rawCaseId);

	if (parsed === "invalid") return <NotFound />;

	return (
		<CaseFormPage
			key={parsed === "new" ? "new" : parsed}
			caseId={parsed === "new" ? null : parsed}
			startWithAiPanel={parsed === "new" && searchParams.get("mode") === "ai"}
		/>
	);
}
