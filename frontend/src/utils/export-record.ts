import { exportRecordDetail } from "@/api";

/**
 * 下载单个训练记录的导出文本 —— 学生结果页与教师详情页共用（唯一实现）。
 *
 * 失败由调用方决定提示文案（页面各自的 toast 文案不同）。
 */
export async function downloadRecordDetail(recordId: number | string): Promise<void> {
	const res = await exportRecordDetail(recordId);
	const url = URL.createObjectURL(new Blob([res.data], { type: "text/plain" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = `record_${recordId}.txt`;
	link.click();
	URL.revokeObjectURL(url);
}
