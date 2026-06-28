import type { paths } from "./api-types.gen";

/**
 * 从 openapi-typescript 生成的 paths 类型中提取所有有效路径。
 * keyof paths 包含完整的 "/api/..." 路径，strip "/api" 前缀以匹配 axios baseURL。
 */
type FullPath = keyof paths;
type StripApi<T> = T extends `/api${infer Rest}` ? Rest : never;

/** 所有有效 API 路径的联合类型（不含 /api 前缀），由 api-types.gen.ts 自动衍生 */
export type ApiPath = StripApi<FullPath>;


