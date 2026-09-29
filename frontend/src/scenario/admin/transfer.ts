/**
 * 病例 zip 的**浏览器侧搬运**：下载标准模板 / 导出病例 / 取导出字节给编辑器预览。
 *
 * 三个端点都是 zip 流（不是 JSON），所以不能走"接口返回对象"那条路；
 * 这里只做"取字节 + 另存为"，格式内容一律由后端产出（前端不生成 TOML，也不改写 zip）。
 */

import { downloadAdminStandardCase, exportAdminScenarioPack } from "@/api/scenario";

/** 一段字节 → 浏览器"另存为"。 */
function saveBytes(bytes: Blob, filename: string) {
	const url = URL.createObjectURL(bytes);
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

/** 下载标准模板（`key` / `title` 预填进模板文本；留空就用平台的默认占位）。 */
export async function downloadStandardCase(key: string, title: string) {
	const response = await downloadAdminStandardCase(key, title);
	saveBytes(response.data, `${key.trim() || "new-case"}.zip`);
}

/** 导出这份病例（无损：`case.toml` + `case.md` + `img/`）。 */
export async function exportCaseFolder(packKey: string) {
	const response = await exportAdminScenarioPack(packKey);
	saveBytes(response.data, `${packKey}.zip`);
}

/** 导出 zip 的原始字节：编辑器「原始」页签读里面的 `case.toml` / `case.md`。 */
export const caseFolderBytes = (packKey: string) =>
	exportAdminScenarioPack(packKey).then((response) => response.data);
