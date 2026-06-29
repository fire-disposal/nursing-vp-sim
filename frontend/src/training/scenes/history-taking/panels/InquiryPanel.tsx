import { useQuery } from "@tanstack/react-query";
import { Circle } from "lucide-react";
import { useMemo } from "react";
import { getRecordDetail } from "@/api/training";

interface Props {
	recordId: string;
}

export default function InquiryPanel({ recordId }: Props) {
	const { data: record } = useQuery({
		queryKey: ["training-record", recordId],
		queryFn: () => getRecordDetail(Number(recordId)).then((r) => r.data),
	});

	const inquiries: string[] = useMemo(() => {
		const cd = ((record as Record<string, unknown>)?.case_data as Record<string, unknown>) || {};
		return (cd.required_inquiries as string[]) || [];
	}, [record]);

	if (inquiries.length === 0) {
		return (
			<div className="text-sm text-muted-foreground text-center py-8">
				该病例未配置问诊清单
			</div>
		);
	}

	return (
		<div className="space-y-1">
			<p className="text-xs text-muted-foreground mb-3">问诊目标 ({inquiries.length}项)</p>
			{inquiries.map((inq, i) => (
				<div key={i} className="flex items-start gap-2 py-1.5">
					<Circle size={14} className="text-gray-300 mt-0.5 shrink-0" />
					<span className="text-sm">{inq}</span>
				</div>
			))}
		</div>
	);
}
