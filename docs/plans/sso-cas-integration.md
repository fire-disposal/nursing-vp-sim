# CAS SSO 对接预案

## 一、现状分析

- 已有 `CASLoginStrategy` 骨架（Strategy Pattern），已注册但 `authenticate()` 抛 `NotImplementedError`
- 用户模型已有 `student_id` 字段，可用作 CAS 学号关联键
- 已有 JWT 签发体系（HS256，8 小时过期）和前端 `ProtectedRoute` 鉴权体系
- 需新建 `sso_providers` 配置表以支持多校对接

## 二、待办事项清单

| 序号 | 任务 | 模块 | 优先级 |
|------|------|------|--------|
| 1 | 新建 `sso_providers` 表 | 数据库 | P0 |
| 2 | 实现 `CASLoginStrategy.authenticate()` | 后端 | P0 |
| 3 | 新增 SSO 路由 (`/api/auth/sso/cas/...`) | 后端 | P0 |
| 4 | 前端登录页增加"统一认证登录"入口 | 前端 | P0 |
| 5 | 配置管理后台（启用/禁用/配置 CAS 参数） | 后端+前端 | P1 |
| 6 | 编写集成测试 | 测试 | P1 |

## 三、关键决策点

### 1. 账号匹配策略

- **方案 A**：预先批量导入学生数据（已有 `/api/admin/users/batch` 接口），CAS 登录按 `student_id` 精确匹配
- **方案 B**：CAS 验证通过后自动创建账号（降低管理员工作量，但需约定角色默认值）
- **推荐**：先 B（自动创建），后期按学校需求可切 A——两种模式可在代码中同时支持

### 2. 密码登录共存

- 通过 CAS 登录的学生，是否允许同时使用密码登录？
- **推荐**：保留密码登录入口，CAS 仅在登录页提供可选入口，双轨并行

### 3. 多校隔离

- 同一 CAS 学号可能在不同学校重复
- **推荐**：`sso_providers` 绑定 `school_id`，匹配时加上 `school_id` 条件，确保数据隔离

## 四、数据库变更

```sql
CREATE TABLE sso_providers (
    id              SERIAL PRIMARY KEY,
    school_id       INTEGER NOT NULL REFERENCES schools(id),
    provider_type   VARCHAR(20) NOT NULL DEFAULT 'cas',
    name            VARCHAR(50) NOT NULL,
    is_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
    config          JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
```

`config` 字段示例（CAS）：

```json
{
  "cas_server_url": "https://cas.school.edu.cn",
  "cas_version": "v3",
  "service_url": "https://vp.school.edu.cn/api/auth/sso/cas/callback"
}
```

## 五、API 端点设计

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/auth/sso/cas/{school_id}/login` | GET | 生成 CAS 重定向 URL，前端跳转 |
| `/api/auth/sso/cas/{school_id}/callback?ticket=ST-xxx` | GET | CAS ticket 回调，验证后签发 JWT 并重定向前端 |
| `/api/admin/sso` | GET | 查询 SSO 配置列表 |
| `/api/admin/sso/{id}` | PUT | 更新 SSO 配置 |
| `/api/admin/sso/{id}/toggle` | POST | 启用/禁用 SSO 配置 |

## 六、CAS 认证流程

```
用户点击"统一认证登录"
  → 前端 GET /api/auth/sso/cas/{school_id}/login
    → 后端返回 { redirect_url: "https://cas.school.edu.cn/login?service=..." }
      → 浏览器重定向到 CAS 登录页
        → 用户输入学号密码，CAS 验证通过
          → CAS 重定向回 service URL: /api/auth/sso/cas/{school_id}/callback?ticket=ST-xxx
            → 后端调用 CAS /serviceValidate 验证 ticket，解析 XML 获取学号
              → 按 school_id + student_id 匹配或创建 User
                → 签发 JWT，重定向前端首页（带 token）
```

## 七、安全要点

- Service URL 必须白名单校验，防止开放重定向漏洞
- CAS ticket 一次有效，防止重放攻击
- HTTPS 全链路，ticket 和 token 均不暴露在 URL 日志中
- `sso_providers.config` 中的 CAS 服务器地址由服务端校验，不可由前端传入
- ticket 验证失败时返回明确错误，不泄露 CAS 服务器内部信息

## 八、前端改动范围

| 改动 | 文件 |
|------|------|
| 登录页增加"统一认证登录"按钮 | `frontend/src/pages/Login.tsx` |
| 新增 CAS 回调处理页（提取 URL 中的 token） | `frontend/src/pages/SSOCallback.tsx` |
| AuthStore 增加 SSO 登录方法 | `frontend/src/stores/authStore.ts` |
| API Client 增加 CAS 相关接口 | `frontend/src/api/api-client.ts` |

## 九、预计工作量

| 模块 | 估时 |
|------|------|
| 数据库迁移 + 管理 API | 1d |
| CAS 策略实现 + 路由 | 1d |
| 前端登录页改造 | 0.5d |
| 管理后台配置页 | 0.5d |
| 联调测试 | 1d |
| **合计** | **4d** |
