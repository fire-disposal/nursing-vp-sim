#!/usr/bin/env node
/**
 * 从 openapi.json 生成微信小程序 API 客户端类型和函数。
 * 用法: node scripts/generate-miniapp-api.mjs
 * 输出: miniprogram/api/types.gen.ts
 */

import { readFileSync, writeFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, "..")
const spec = JSON.parse(readFileSync(resolve(root, "openapi.json"), "utf-8"))

const schemas = spec.components?.schemas || {}
const paths = spec.paths || {}

// ── 收集所有用到的 schema，递归解析 $ref ──
function resolveRef(ref) {
  const parts = ref.replace("#/components/schemas/", "").split("/")
  let obj = schemas
  for (const p of parts) obj = obj[p]
  return obj
}

function tsType(schema, indent = "") {
  if (!schema) return "unknown"
  if (schema.$ref) {
    const name = schema.$ref.replace("#/components/schemas/", "")
    return name
  }
  if (schema.anyOf) return schema.anyOf.map((s) => tsType(s)).join(" | ")
  if (schema.oneOf) return schema.oneOf.map((s) => tsType(s)).join(" | ")

  switch (schema.type) {
    case "string": return schema.enum ? schema.enum.map((e) => `"${e}"`).join(" | ") : "string"
    case "integer":
    case "number": return "number"
    case "boolean": return "boolean"
    case "null": return "null"
    case "array": return `${tsType(schema.items)}[]`
    case "object": {
      if (!schema.properties) return "Record<string, unknown>"
      const props = Object.entries(schema.properties)
        .filter(([, v]) => !v.readOnly)
        .map(([k, v]) => {
          const required = schema.required?.includes(k) ? "" : "?"
          return `${indent}  ${k}${required}: ${tsType(v, indent + "  ")}`
        })
      return `{\n${props.join("\n")}\n${indent}}`
    }
    default: return "unknown"
  }
}

// ── 生成 interface ──
const seenTypes = new Set()
let typesOutput = "// 自动生成 — 来源 openapi.json\n// 运行 npm run api:generate:miniapp 更新\n\n"

function collectTypes(schema) {
  if (!schema) return
  if (schema.$ref) {
    const name = schema.$ref.replace("#/components/schemas/", "")
    if (!seenTypes.has(name) && schemas[name]) {
      seenTypes.add(name)
      const s = schemas[name]
      if (s.properties) {
        for (const [, v] of Object.entries(s.properties)) collectTypes(v)
      }
    }
    return
  }
  if (schema.items) collectTypes(schema.items)
  if (schema.properties) {
    for (const [, v] of Object.entries(schema.properties)) collectTypes(v)
  }
  if (schema.anyOf) schema.anyOf.forEach(collectTypes)
  if (schema.oneOf) schema.oneOf.forEach(collectTypes)
}

// 收集学生端相关的 schema
const studentEndpoints = [
  "LoginRequest", "TokenResponse", "WechatLoginRequest", "WechatLoginResponse", "WechatBindRequest",
  "UserBrief",
  "CaseBrief", "PaginatedResponse_CaseBrief_",
  "TrainingStartRequest", "TrainingStartResponse",
  "TrainingRecordBrief", "PaginatedResponse_TrainingRecordBrief_",
  "TrainingRecordDetail", "MessageItem", "ScoreItem",
  "ChatMessageRequest", "ChatMessageResponse",
  "DurationStats", "TrendStats",
  "OkResponse",
]

for (const name of studentEndpoints) {
  const exact = schemas[name]
  if (exact && !seenTypes.has(name)) {
    seenTypes.add(name)
    if (exact.properties) {
      for (const [, v] of Object.entries(exact.properties)) collectTypes(v)
    }
  }
}

// 收集所有 $ref 引用的类型
for (const [, methodMap] of Object.entries(paths)) {
  for (const [, op] of Object.entries(methodMap)) {
    if (op.tags?.includes("教师")) continue
    if (op.requestBody) collectTypes(op.requestBody.content?.["application/json"]?.schema)
    for (const [, resp] of Object.entries(op.responses || {})) {
      collectTypes(resp.content?.["application/json"]?.schema)
    }
  }
}

// 输出所有 interface
for (const name of Object.keys(schemas).sort()) {
  if (!seenTypes.has(name)) continue
  const s = schemas[name]
  if (!s.properties) continue
  typesOutput += `export interface ${name} {\n`
  const required = s.required || []
  for (const [key, prop] of Object.entries(s.properties)) {
    if (prop.readOnly) continue
    const opt = required.includes(key) ? "" : "?"
    typesOutput += `  ${key}${opt}: ${tsType(prop, "  ")}\n`
  }
  typesOutput += "}\n\n"
}

// ── 生成 API 函数 ──
typesOutput += "// ── API 函数 ──\n"
typesOutput += "import { get, post, request } from \"./client\"\n\n"

const endpointStyle = {
  "/api/auth/login": { fn: "login", method: "POST", body: "LoginRequest", res: "TokenResponse" },
  "/api/auth/me": { fn: "getMe", method: "GET", res: "UserBrief" },
  "/api/auth/wechat/login": { fn: "wechatLogin", method: "POST", body: "WechatLoginRequest", res: "WechatLoginResponse" },
  "/api/auth/wechat/bind": { fn: "wechatBind", method: "POST", body: "WechatBindRequest", res: "OkResponse" },
  "/api/cases": { fn: "getCases", method: "GET", res: "PaginatedResponse_CaseBrief_", params: "offset?: number; limit?: number" },
  "/api/training/start": { fn: "startTraining", method: "POST", body: "TrainingStartRequest", res: "TrainingStartResponse" },
  "/api/training/{record_id}/end": { fn: "endTraining", method: "POST" },
  "/api/training/records": { fn: "getRecords", method: "GET", res: "PaginatedResponse_TrainingRecordBrief_", params: "offset?: number; limit?: number; status?: string" },
  "/api/training/records/{record_id}": { fn: "getRecordDetail", method: "GET", res: "TrainingRecordDetail" },
  "/api/chat/{record_id}/message": { fn: "sendMessage", method: "POST", body: "ChatMessageRequest", res: "ChatMessageResponse" },
  "/api/stats/duration": { fn: "getDurationStats", method: "GET", res: "DurationStats", params: "period?: string" },
  "/api/stats/trends": { fn: "getTrends", method: "GET", res: "TrendStats", params: "period?: string" },
}

for (const [path, cfg] of Object.entries(endpointStyle)) {
  const fn = cfg.fn
  const method = cfg.method
  const resType = cfg.res || "unknown"
  const params = cfg.params
  const body = cfg.body

  if (body) {
    const apiPath = path.replace(/\{(\w+)\}/g, "${$1}")
    typesOutput += `export function ${fn}(`
    if (path.includes("record_id")) typesOutput += `recordId: number, `
    typesOutput += `data: ${body}): Promise<${resType}> {\n`
    typesOutput += `  return ${method === "POST" ? "post" : "get"}<${resType}>(\`${apiPath}\`, data as unknown as Record<string, unknown>)\n`
    typesOutput += "}\n\n"
  } else if (params) {
    const apiPath = path.replace(/\{(\w+)\}/g, "${$1}")
    typesOutput += `export function ${fn}(`
    if (path.includes("record_id")) typesOutput += `recordId: number, `
    typesOutput += `params?: { ${params} }): Promise<${resType}> {\n`
    typesOutput += `  return get<${resType}>(\`${apiPath}\`, params as Record<string, string | number | undefined>)\n`
    typesOutput += "}\n\n"
  } else {
    const apiPath = path.replace(/\{(\w+)\}/g, "${$1}")
    typesOutput += `export function ${fn}(`
    if (path.includes("record_id")) typesOutput += `recordId: number`
    typesOutput += `): Promise<${resType}> {\n`
    typesOutput += `  return ${method === "DELETE" ? "request" : "get"}<${resType}>("${method}", \`${apiPath}\`)\n`
    typesOutput += "}\n\n"
  }
}

writeFileSync(resolve(root, "miniprogram", "api", "types.gen.ts"), typesOutput, "utf-8")
console.log("✓ miniprogram/api/types.gen.ts generated")
