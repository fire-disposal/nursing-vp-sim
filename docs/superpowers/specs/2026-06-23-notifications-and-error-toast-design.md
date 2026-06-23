# 设计稿：统一错误 toast + 通知系统全量修复

**日期**: 2026-06-23
**状态**: 已批准（用户全部批准）

---

## 设计 A — 统一错误 toast + 向上有序堆叠

### 现状
- 单库 sonner + 封装 `frontend/src/components/Toast.tsx`（`success/error/warning/info`，每次唯一自增 id）。
- `<Toaster>`（`frontend/src/components/ui/sonner.tsx`）未设 `expand` → sonner 默认折叠堆叠，多条 toast 视觉重叠、默认只露 3 条。
- 错误提示不统一：`useScoringNotifications.ts` 直连 sonner；多处手写 `err.response?.data?.detail || "兜底"`；axios 拦截器不弹 toast。

### 改法
1. `ui/sonner.tsx` `<Toaster>` 增配：`expand`、`position="bottom-right"`（新条在下、旧条向上有序浮动）、`visibleToasts={5}`、`gap={8}`、`closeButton`。
2. `Toast.tsx` 增 `apiError(e, fallback?)`：集中提取 `err.response?.data?.detail`，统一兜底 + 6s 时长；对相同文案做短时去重（用稳定 id 合并相同消息）。
3. 全仓替换手写 detail 提取 → `toast.apiError(...)`；`useScoringNotifications` 改用封装，消除裸 sonner。

### 决策（已定）
- 位置 bottom-right（向上浮动）。
- 相同错误去重。

---

## 设计 B — 通知系统全量修复

### B1 模型/迁移（autogenerate DDL）
- `Notification.record_id` → `ForeignKey("training_records.id", ondelete="CASCADE")`。
- 新增 `updated_at` 列。
- `type` 不加 CHECK（保持灵活）。
- `pnpm run db:migration -- "notification_fk_updated_at"`，校验 upgrade/downgrade roundtrip。

### B2 触发可靠性
- 评分失败/超时也建通知（不止成功路径）。
- 发布任务（`main.py:_notification_publisher`）：零活跃用户不误标已发布并记日志；避免 `is_active` 复活重发；阻塞查询包 `asyncio.to_thread`；修 advisory unlock finally 吞错。
- `delete_record` 依赖新 FK CASCADE 自动清理通知。

### B3 接口/Schema
- `get_notifications`：分页（`limit/offset`）+ `unread_only` 支持查看已读历史；返回 `is_read`；`created_at` 改 `datetime`（去掉 `str()`）。
- `system_notifications`：列表分页；PUT 编辑不再重新触发群发（不复活 `is_active`）；删除级联；`published_at=None` 视为即时发布（创建落 `now()`）。
- `ops` 未读统计加时间边界（近 30d）。
- 改 schema 后 `pnpm run api:update:all`。

### B4 前端
- `useScoringNotifications` 收到 `scoring_complete` → `invalidateQueries(["notifications"])`，铃铛即时刷新；轮询延长为兜底。
- `NotificationBell`：loading/error 态、badge `99+`、乐观已读与跳转顺序修正、system 类型点击目标。
- `SystemNotificationsPage`：正文多行 `textarea`、删除确认、修 `datetime-local` 时区、支持 `is_active` 草稿/停用。

### 验证
- 后端：`pytest tests/training/test_notifications.py` + 迁移 roundtrip。
- 前端：`tsc --noEmit` + `biome check`。

### 顺序
A 先（小、独立），B 后（分 B1→B4 阶段，逐阶段验证）。
