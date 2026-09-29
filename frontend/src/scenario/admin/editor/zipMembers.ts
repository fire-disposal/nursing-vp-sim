/**
 * 从 zip 字节里取出**指定的几个文本成员**——只服务编辑器「原始」页签的只读预览。
 *
 * 为什么这里有一小段 zip 解析：TOML / MD 的真源在**后端**（`export.zip` 就是它的原样输出），
 * 前端不该再实现一套 TOML 生成；所以预览读的就是后端产出的那两个文件本身。
 * 只认后端 `case_folder.zip_bytes` 会产出的那一种 zip：deflate / stored、无加密、非 zip64。
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const DEFLATED = 8;

/** 成员名（保留 `cases/<key>/` 这样的前缀）→ 解压后的字节。 */
async function zipEntries(data: ArrayBuffer): Promise<[string, Uint8Array<ArrayBuffer>][]> {
	const bytes = new Uint8Array(data);
	const view = new DataView(data);

	// 中央目录的末尾记录（EOCD）在文件最后，注释最多 64KB：从后往前找签名
	let eocd = bytes.length - 22;
	while (eocd >= 0 && view.getUint32(eocd, true) !== EOCD_SIGNATURE) eocd -= 1;
	if (eocd < 0) throw new Error("不是合法的 zip（找不到中央目录）");

	const count = view.getUint16(eocd + 10, true);
	let cursor = view.getUint32(eocd + 16, true);
	const entries: [string, Uint8Array<ArrayBuffer>][] = [];
	const decoder = new TextDecoder();

	for (let index = 0; index < count; index += 1) {
		if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) throw new Error("zip 的中央目录坏了");
		const method = view.getUint16(cursor + 10, true);
		const compressedSize = view.getUint32(cursor + 20, true);
		const nameLength = view.getUint16(cursor + 28, true);
		const extraLength = view.getUint16(cursor + 30, true);
		const commentLength = view.getUint16(cursor + 32, true);
		const localOffset = view.getUint32(cursor + 42, true);
		const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

		// 本地头的名字与额外字段长度可能与中央目录不同（尤其带额外字段时）：现场读一次
		const localNameLength = view.getUint16(localOffset + 26, true);
		const localExtraLength = view.getUint16(localOffset + 28, true);
		const start = localOffset + 30 + localNameLength + localExtraLength;
		const payload = bytes.subarray(start, start + compressedSize);

		if (!name.endsWith("/")) {
			entries.push([name, method === DEFLATED ? await inflateRaw(payload) : payload]);
		}
		cursor += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

/** deflate-raw 解压（直接用字节做 body：`Blob.stream()` 在测试环境里没有实现）。 */
async function inflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
	const reader = new Response(bytes)
		.body!.pipeThrough(new DecompressionStream("deflate-raw"))
		.getReader();
	const chunks: Uint8Array<ArrayBuffer>[] = [];
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
	}
	const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

/**
 * 读出 `names` 里的文本成员（按后端给定的名字，如 `case.toml` / `case.md`）。
 * 成员名可能带一层病例根目录，所以按**结尾**匹配；没找到的名字不出现在结果里。
 */
export async function zipTextMembers(
	data: Blob,
	names: readonly string[],
): Promise<Record<string, string>> {
	const entries = await zipEntries(await data.arrayBuffer());
	const decoder = new TextDecoder();
	const out: Record<string, string> = {};
	for (const name of names) {
		const hit = entries.find(([member]) => member === name || member.endsWith(`/${name}`));
		if (hit !== undefined) out[name] = decoder.decode(hit[1]);
	}
	return out;
}
