# PiOps 调查报告

本目录保存 PiOps 在证据不足、无法安全修复或需要人工决策时生成的长期调查报告。

## 规则

- 每次无法安全修复时，必须新增一份 Markdown 报告；不能只写临时运行目录。
- 文件名使用 `YYYY-MM-DD-<short-topic>.md`；同名时追加 `-2`、`-3` 等序号。
- 报告使用中文，并包含：Summary、Evidence、Root cause、Changes、Validation、Risks、Rollback。
- 报告应明确写出是否修改源码；没有源码修复时写明“未修改源码”。

`.piops-runtime/pi-report.md` 仍作为本次 workflow 的机器报告和 PR 描述来源；本目录中的报告是仓库内的长期记录。
