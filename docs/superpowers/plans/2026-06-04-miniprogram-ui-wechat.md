# 小程序 UI 优化 & 微信认证 实施计划

> **For agentic workers:** 使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐步实施。任务使用 `- [ ]` checkbox 跟踪。

**Goal:** 小程序整体 UI 升级（含 Tab 导航、Lottie 登录页、我的页面、反馈页）并支持微信一键注册/登录和已有账号微信绑定。

**Architecture:** 后端新增 `/api/auth/wechat/register` 端点；小程序端新增 Tab 栏配置、重设计登录页、新增「我的」和「意见反馈」页面、全局视觉升级。

**Tech Stack:** Python FastAPI (backend), WeChat Miniprogram + TypeScript + lottie-miniprogram (frontend)

---

### Task 1: 后端新增 wechat/register 端点

**Files:**
- Modify: `backend/schemas.py` (add WechatRegisterRequest)
- Modify: `backend/routers/auth.py` (add wechat_register route)
- Modify: `backend/tests/test_auth.py` (add tests)

**Spec context:** `/api/auth/wechat/register` 接收 `code` + `display_name`，自动创建用户并返回 token。

- [ ] **Step 1: 在 schemas.py 中新增 WechatRegisterRequest**

在 `backend/schemas.py` 的 `WechatBindRequest` 之后添加：

```python
class WechatRegisterRequest(BaseModel):
    code: str
    display_name: str = Field(min_length=1, max_length=50)
```

- [ ] **Step 2: 在 auth.py 中新增 wechat_register 路由**

在 `backend/routers/auth.py` 文件末尾（`get_me` 之前）添加，同时更新 import：

Import 添加 `WechatRegisterRequest`：
```python
from schemas import (
    ...
    WechatRegisterRequest,
    ...
)
```

新增路由实现：
```python
@router.post("/wechat/register", response_model=TokenResponse)
async def wechat_register(
    req: WechatRegisterRequest,
    db: Annotated[Session, Depends(get_db)],
):
    """微信一键注册：通过 code 获取 openid，自动创建用户并返回 token"""
    import secrets
    import string

    from services.wechat import code2session

    try:
        session = await code2session(req.code)
    except RuntimeError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    openid = session.get("openid")
    if not openid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="微信登录失败：无法获取 openid")

    existing = db.query(User).filter(User.wechat_openid == openid).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="此微信已注册，请直接登录")

    suffix = "".join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(8))
    username = f"wx_{suffix}"
    while db.query(User).filter(User.username == username).first():
        suffix = "".join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(8))
        username = f"wx_{suffix}"

    random_password = secrets.token_urlsafe(16)
    user = User(
        username=username,
        password_hash=hash_password(random_password),
        role="student",
        display_name=req.display_name,
        wechat_openid=openid,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token({"user_id": user.id, "role": user.role})
    log.info("微信注册成功: openid=%s username=%s", openid, username)
    return TokenResponse(
        access_token=token,
        role=user.role,
        display_name=user.display_name,
        user_id=user.id,
    )
```

- [ ] **Step 3: 在 test_auth.py 中新增测试类 TestWechatRegister**

在 `backend/tests/test_auth.py` 末尾添加：

```python
class TestWechatRegister:
    def test_wechat_register_creates_user(self, client, db_session, monkeypatch):
        """微信注册：code 有效时应创建新用户并返回 token"""
        async def mock_code2session(code):
            return {"openid": "test_openid_register_001"}

        from services import wechat as wechat_module
        monkeypatch.setattr(wechat_module, "code2session", mock_code2session)

        resp = client.post(
            "/api/auth/wechat/register",
            json={"code": "valid_code", "display_name": "微信用户"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["access_token"]
        assert data["role"] == "student"
        assert data["display_name"] == "微信用户"

        from models import User
        user = db_session.query(User).filter(User.wechat_openid == "test_openid_register_001").first()
        assert user is not None
        assert user.username.startswith("wx_")

    def test_wechat_register_duplicate_openid(self, client, db_session, monkeypatch):
        """微信注册：重复 openid 应返回 400"""
        from auth import hash_password
        from models import User

        user = User(
            username="existing_wx_user",
            password_hash=hash_password("x"),
            role="student",
            display_name="已有用户",
            wechat_openid="dup_openid_002",
        )
        db_session.add(user)
        db_session.commit()

        async def mock_code2session(code):
            return {"openid": "dup_openid_002"}

        from services import wechat as wechat_module
        monkeypatch.setattr(wechat_module, "code2session", mock_code2session)

        resp = client.post(
            "/api/auth/wechat/register",
            json={"code": "dup_code", "display_name": "新用户"},
        )
        assert resp.status_code == 400
        assert "已注册" in str(resp.json().get("detail", ""))

    def test_wechat_register_empty_display_name(self, client):
        """微信注册：昵称为空应返回 422"""
        resp = client.post(
            "/api/auth/wechat/register",
            json={"code": "x", "display_name": ""},
        )
        assert resp.status_code == 422
```

- [ ] **Step 4: 运行后端测试验证**

```bash
cd backend
python -m pytest tests/test_auth.py::TestWechatRegister -v
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/schemas.py backend/routers/auth.py backend/tests/test_auth.py
git commit -m "feat: add wechat/register endpoint for one-click registration"
```

---

### Task 2: 小程序 Lottie 动画集成

**Files:**
- Modify: `miniprogram/package.json`
- Create: `miniprogram/components/lottie-player/lottie-player.json`
- Create: `miniprogram/components/lottie-player/lottie-player.wxml`
- Create: `miniprogram/components/lottie-player/lottie-player.ts`
- Copy: `frontend/src/assets/lottie/animation.json` → `miniprogram/assets/lottie/animation.json`

- [ ] **Step 1: 安装 lottie-miniprogram**

```bash
cd miniprogram
npm install lottie-miniprogram --save
```

- [ ] **Step 2: 复制 Lottie 动画文件**

```bash
New-Item -ItemType Directory -Force -Path "miniprogram\assets\lottie"
Copy-Item "frontend\src\assets\lottie\animation.json" "miniprogram\assets\lottie\animation.json"
```

- [ ] **Step 3: 创建 lottie-player 组件**

Create `miniprogram/components/lottie-player/lottie-player.json`:
```json
{
  "component": true,
  "usingComponents": {}
}
```

Create `miniprogram/components/lottie-player/lottie-player.wxml`:
```xml
<canvas
  type="2d"
  id="lottie-canvas"
  class="lottie-canvas"
  style="width: {{width}}rpx; height: {{height}}rpx;"
></canvas>
```

Create `miniprogram/components/lottie-player/lottie-player.ts`:
```typescript
import lottie from "lottie-miniprogram"

Component({
  properties: {
    width: { type: Number, value: 400 },
    height: { type: Number, value: 400 },
    autoplay: { type: Boolean, value: true },
    loop: { type: Boolean, value: true },
  },

  data: {
    animationData: null as Record<string, unknown> | null,
  },

  lifetimes: {
    attached() {
      this.initAnimation()
    },
  },

  methods: {
    initAnimation() {
      const query = this.createSelectorQuery()
      query.select("#lottie-canvas")
        .node((res: WechatMiniprogram.NodesRefResult) => {
          if (!res || !res.node) return
          const canvas = res.node as unknown as WechatMiniprogram.Canvas
          const context = canvas.getContext("2d")
          canvas.width = this.properties.width * 2
          canvas.height = this.properties.height * 2

          lottie.setup(canvas)
          const anim = lottie.loadAnimation({
            loop: this.properties.loop,
            autoplay: this.properties.autoplay,
            animationData: this.data.animationData,
            rendererSettings: {
              context,
            },
          })
          this._anim = anim
        })
        .exec()

      this.loadAnimationData()
    },

    loadAnimationData() {
      try {
        const data = require("../../assets/lottie/animation.json")
        this.setData({ animationData: data as Record<string, unknown> })
        // reload with data
        setTimeout(() => {
          this.initAnimation()
        }, 100)
      } catch { /* animation.json not found */ }
    },
  },
})
```

- [ ] **Step 4: Commit**

```bash
git add miniprogram/package.json miniprogram/package-lock.json miniprogram/components/lottie-player/ miniprogram/assets/lottie/
git commit -m "feat: add lottie-miniprogram and reusable lottie-player component"
```

---

### Task 3: 配置 Tab 栏

**Files:**
- Modify: `miniprogram/app.json`

**Spec context:** 首页/训练/记录/我的 四个 Tab，登录页和训练详情页不在 Tab 中。

- [ ] **Step 1: 创建 Tab 图标目录**

```bash
New-Item -ItemType Directory -Force -Path "miniprogram\assets\icons"
```

- [ ] **Step 2: 生成 Tab 图标（用 Node.js 生成 81x81 PNG）**

Create `miniprogram/scripts/gen-icons.js`:
```javascript
const fs = require("fs")
const path = require("path")

const ICONS_DIR = path.join(__dirname, "..", "assets", "icons")

function createIconPNG(colorHex) {
  const r = parseInt(colorHex.slice(1, 3), 16)
  const g = parseInt(colorHex.slice(3, 5), 16)
  const b = parseInt(colorHex.slice(5, 7), 16)

  // Minimal 81x81 solid color PNG
  const size = 81
  const rawData = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    rawData[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const offset = y * (size * 4 + 1) + 1 + x * 4
      const isCorner = true
      rawData[offset] = r
      rawData[offset + 1] = g
      rawData[offset + 2] = b
      rawData[offset + 3] = 255
    }
  }

  const zlib = require("zlib")
  const deflated = zlib.deflateSync(rawData)

  function crc32(buf) {
    let c
    const table = []
    for (let n = 0; n < 256; n++) {
      c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
    c = 0xffffffff
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr_data = Buffer.alloc(13)
  ihdr_data.writeUInt32BE(size, 0)
  ihdr_data.writeUInt32BE(size, 4)
  ihdr_data[8] = 8  // bit depth
  ihdr_data[9] = 6  // color type (RGBA)
  ihdr_data[10] = 0 // compression
  ihdr_data[11] = 0 // filter
  ihdr_data[12] = 0 // interlace

  const ihdr_type = Buffer.from("IHDR")
  const ihdr_chunk = Buffer.concat([ihdr_data, ihdr_type])
  const ihdr_length = Buffer.alloc(4)
  ihdr_length.writeUInt32BE(13, 0)
  const ihdr_crc_data = Buffer.concat([ihdr_type, ihdr_data])
  const ihdr_crc = Buffer.alloc(4)
  ihdr_crc.writeUInt32BE(crc32(ihdr_crc_data), 0)

  const idat_type = Buffer.from("IDAT")
  const idat_length = Buffer.alloc(4)
  idat_length.writeUInt32BE(deflated.length, 0)
  const idat_crc_data = Buffer.concat([idat_type, deflated])
  const idat_crc = Buffer.alloc(4)
  idat_crc.writeUInt32BE(crc32(idat_crc_data), 0)

  const iend_type = Buffer.from("IEND")
  const iend_crc_data = iend_type
  const iend_crc = Buffer.alloc(4)
  iend_crc.writeUInt32BE(crc32(iend_crc_data), 0)

  return Buffer.concat([
    signature,
    ihdr_length, ihdr_type, ihdr_data, ihdr_crc,
    idat_length, idat_type, deflated, idat_crc,
    Buffer.alloc(4, 0), iend_type, iend_crc,
  ])
}

const colors = {
  home: "#2563eb",
  home_active: "#1d4ed8",
  train: "#2563eb",
  train_active: "#1d4ed8",
  history: "#2563eb",
  history_active: "#1d4ed8",
  profile: "#2563eb",
  profile_active: "#1d4ed8",
}

for (const [name, color] of Object.entries(colors)) {
  fs.writeFileSync(path.join(ICONS_DIR, `${name}.png`), createIconPNG(color))
  fs.writeFileSync(path.join(ICONS_DIR, `${name}_active.png`), createIconPNG(color))
}

console.log("Icons generated in", ICONS_DIR)
```

Run:
```bash
cd miniprogram
node scripts/gen-icons.js
```

- [ ] **Step 3: 更新 app.json，添加 tabBar 配置**

Replace `miniprogram/app.json`:
```json
{
  "pages": [
    "pages/login/login",
    "pages/home/home",
    "pages/cases/cases",
    "pages/history/history",
    "pages/training/training",
    "pages/record-detail/record-detail",
    "pages/profile/profile",
    "pages/feedback/feedback"
  ],
  "window": {
    "navigationStyle": "custom",
    "backgroundColor": "#f5f6f8"
  },
  "tabBar": {
    "color": "#9ca3af",
    "selectedColor": "#2563eb",
    "backgroundColor": "#ffffff",
    "borderStyle": "black",
    "list": [
      {
        "pagePath": "pages/home/home",
        "text": "首页",
        "iconPath": "assets/icons/home.png",
        "selectedIconPath": "assets/icons/home_active.png"
      },
      {
        "pagePath": "pages/cases/cases",
        "text": "训练",
        "iconPath": "assets/icons/train.png",
        "selectedIconPath": "assets/icons/train_active.png"
      },
      {
        "pagePath": "pages/history/history",
        "text": "记录",
        "iconPath": "assets/icons/history.png",
        "selectedIconPath": "assets/icons/history_active.png"
      },
      {
        "pagePath": "pages/profile/profile",
        "text": "我的",
        "iconPath": "assets/icons/profile.png",
        "selectedIconPath": "assets/icons/profile_active.png"
      }
    ]
  },
  "style": "v2",
  "sitemapLocation": "sitemap.json",
  "lazyCodeLoading": "requiredComponents",
  "usingComponents": {}
}
```

- [ ] **Step 4: 更新各页面导航方式**

由于引入了 tabBar，需要将之前的 `wx.navigateTo` 改为 `wx.switchTab`（对于 tab 页面）。

在 `miniprogram/pages/home/home.ts` 中 `goBack` 类似方法从 `wx.redirectTo` 改为 `wx.switchTab`；`training.ts` 中 `goBack` 从 `wx.redirectTo({url:'/pages/home/home'})` 改为 `wx.switchTab({url:'/pages/home/home'})`。

```bash
# 查找所有引用 home/cases/history 页面的 navigateTo/redirectTo/reLaunch
# training.ts goBack → 改为 switchTab
# record-detail 返回 → 改为 switchTab 到 history
```

Update `miniprogram/pages/training/training.ts:230`:
```typescript
// Before:
wx.redirectTo({ url: "/pages/home/home" })
// After:
wx.switchTab({ url: "/pages/home/home" })
```

Update `miniprogram/pages/training/training.ts:216`:
```typescript
// Before:
wx.redirectTo({ url: "/pages/home/home" })
// After:
wx.switchTab({ url: "/pages/home/home" })
```

- [ ] **Step 5: Commit**

```bash
git add miniprogram/app.json miniprogram/assets/icons/ miniprogram/scripts/gen-icons.js miniprogram/pages/training/training.ts
git commit -m "feat: add tabBar with 4 tabs (首页/训练/记录/我的)"
```

---

### Task 4: 更新小程序 auth API

**Files:**
- Modify: `miniprogram/api/auth.ts`

- [ ] **Step 1: 新增 wechatLogin, wechatBind, wechatRegister 函数**

Replace `miniprogram/api/auth.ts`:
```typescript
import { get, post } from "./client"

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  access_token: string
  token_type: string
  role: string
  display_name: string
  user_id: number
}

export interface UserProfile {
  id: number
  username: string
  role: string
  display_name: string
  student_id: string | null
  class_id: number | null
  created_at: string
}

export interface WechatLoginResponse {
  access_token: string | null
  token_type: string
  role: string | null
  display_name: string | null
  user_id: number | null
  need_bind: boolean
}

export interface WechatRegisterRequest {
  code: string
  display_name: string
}

export function login(data: LoginRequest) {
  return post<LoginResponse>("/api/auth/login", data as unknown as Record<string, unknown>)
}

export function getMe() {
  return get<UserProfile>("/api/auth/me")
}

export function wechatLogin(code: string) {
  return post<WechatLoginResponse>("/api/auth/wechat/login", { code } as unknown as Record<string, unknown>)
}

export function wechatBind(code: string) {
  return post<{ ok: boolean }>("/api/auth/wechat/bind", { code } as unknown as Record<string, unknown>)
}

export function wechatRegister(data: WechatRegisterRequest) {
  return post<LoginResponse>("/api/auth/wechat/register", data as unknown as Record<string, unknown>)
}
```

- [ ] **Step 2: Commit**

```bash
git add miniprogram/api/auth.ts
git commit -m "feat: add wechatLogin, wechatBind, wechatRegister to miniprogram auth API"
```

---

### Task 5: 重设计登录页

**Files:**
- Modify: `miniprogram/pages/login/login.json`
- Modify: `miniprogram/pages/login/login.wxml`
- Modify: `miniprogram/pages/login/login.wxss`
- Modify: `miniprogram/pages/login/login.ts`

- [ ] **Step 1: 注册 lottie-player 组件**

Replace `miniprogram/pages/login/login.json`:
```json
{
  "usingComponents": {
    "lottie-player": "/components/lottie-player/lottie-player"
  },
  "navigationStyle": "custom"
}
```

- [ ] **Step 2: 重写 login.wxml**

Replace `miniprogram/pages/login/login.wxml`:
```xml
<view class="page">
  <view class="bg-decor">
    <view class="bg-blob bg-blob-1"></view>
    <view class="bg-blob bg-blob-2"></view>
    <view class="bg-blob bg-blob-3"></view>
  </view>

  <view class="content">
    <!-- 微信登录模式 -->
    <block wx:if="{{mode === 'wechat'}}">
      <view class="lottie-wrap">
        <lottie-player width="400" height="400" autoplay="{{true}}" loop="{{true}}" />
      </view>
      <view class="brand">
        <text class="brand-title">虚拟患者训练系统</text>
        <text class="brand-desc">护理病史采集技能训练平台</text>
      </view>
      <button class="wechat-btn" bindtap="handleWechatLogin" loading="{{loading}}" disabled="{{loading}}">
        <text class="wechat-icon">✦</text>
        <text>{{loading ? '登录中...' : '微信一键登录'}}</text>
      </button>
      <text class="switch-mode" bindtap="switchMode">使用账号密码登录 →</text>
    </block>

    <!-- 账号密码登录模式 -->
    <block wx:else>
      <view class="brand brand-compact">
        <text class="brand-title">虚拟患者训练系统</text>
        <text class="brand-desc">护理病史采集技能训练平台</text>
      </view>
      <view class="card">
        <view class="error" wx:if="{{error}}">{{error}}</view>
        <input class="input" placeholder="用户名" value="{{username}}" bindinput="onUsernameInput" auto-focus />
        <input class="input" type="password" placeholder="密码" value="{{password}}" bindinput="onPasswordInput" />
        <button class="btn-primary" bindtap="handleLogin" loading="{{loading}}" disabled="{{loading}}">
          {{loading ? '登录中...' : '登 录'}}
        </button>
      </view>
      <text class="switch-mode" bindtap="switchMode">← 返回微信登录</text>
    </block>

    <text class="footer-text">虚拟患者 · 护理教学平台</text>
  </view>
</view>
```

- [ ] **Step 3: 重写 login.wxss**

Replace `miniprogram/pages/login/login.wxss`:
```css
.page {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  overflow: hidden;
  background: linear-gradient(135deg, #f0f4ff 0%, #ffffff 40%, #f0fdfa 100%);
}

.bg-decor { position: absolute; inset: 0; pointer-events: none; }
.bg-blob {
  position: absolute; border-radius: 50%; filter: blur(80px); opacity: 0.15;
}
.bg-blob-1 { width: 400rpx; height: 400rpx; background: #93c5fd; top: -100rpx; left: -100rpx; }
.bg-blob-2 { width: 300rpx; height: 300rpx; background: #a5f3fc; bottom: -50rpx; right: -80rpx; }
.bg-blob-3 { width: 250rpx; height: 250rpx; background: #c4b5fd; top: 50%; left: 50%; }

.content {
  position: relative; z-index: 1; display: flex; flex-direction: column;
  align-items: center; width: 100%; padding: 48rpx 32rpx;
}

.lottie-wrap {
  width: 400rpx; height: 400rpx; margin-bottom: 16rpx;
}

.brand { text-align: center; margin-bottom: 48rpx; }
.brand-compact { text-align: center; margin-bottom: 40rpx; }
.brand-title { display: block; font-size: 40rpx; font-weight: 700; color: #111827; margin-bottom: 8rpx; }
.brand-desc { display: block; font-size: 26rpx; color: #6b7280; }

.wechat-btn {
  width: 100%; max-width: 600rpx; height: 96rpx;
  background: linear-gradient(135deg, #07c160, #06ad56);
  color: #fff; border: none; border-radius: 48rpx;
  font-size: 32rpx; font-weight: 600; display: flex;
  align-items: center; justify-content: center; gap: 12rpx;
  box-shadow: 0 8rpx 24rpx rgba(7, 193, 96, 0.3);
}
.wechat-btn[disabled] { opacity: 0.6; }
.wechat-icon { font-size: 36rpx; }

.card {
  width: 100%; max-width: 600rpx;
  background: #fff; border-radius: 20rpx; padding: 40rpx 32rpx;
  box-shadow: 0 4rpx 16rpx rgba(0,0,0,0.06);
}

.error {
  background: #fef2f2; color: #dc2626; padding: 16rpx 24rpx;
  border-radius: 8rpx; font-size: 26rpx; margin-bottom: 24rpx; border: 1rpx solid #fecaca;
}

.input {
  width: 100%; height: 88rpx; background: #f9fafb;
  border: 1rpx solid #e5e7eb; border-radius: 12rpx;
  padding: 0 24rpx; font-size: 28rpx; margin-bottom: 24rpx; box-sizing: border-box;
}

.btn-primary {
  width: 100%; height: 88rpx; background: #2563eb;
  color: #fff; border: none; border-radius: 12rpx; font-size: 28rpx; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
}
.btn-primary[disabled] { opacity: 0.5; }

.switch-mode {
  margin-top: 32rpx; font-size: 26rpx; color: #2563eb;
}

.footer-text {
  margin-top: 48rpx; font-size: 22rpx; color: #9ca3af;
}
```

- [ ] **Step 4: 重写 login.ts**

Replace `miniprogram/pages/login/login.ts`:
```typescript
import { login, wechatLogin, wechatRegister } from "../../api/auth"
import { setToken } from "../../utils/format"

const app = getApp<IAppOption>()

Page({
  data: {
    mode: "wechat" as "wechat" | "account",
    username: "",
    password: "",
    loading: false,
    error: "",
  },

  switchMode() {
    this.setData({
      mode: this.data.mode === "wechat" ? "account" : "wechat",
      error: "",
    })
  },

  onUsernameInput(e: WechatMiniprogram.Input) {
    this.setData({ username: e.detail.value, error: "" })
  },

  onPasswordInput(e: WechatMiniprogram.Input) {
    this.setData({ password: e.detail.value, error: "" })
  },

  async handleWechatLogin() {
    this.setData({ loading: true, error: "" })
    try {
      const loginRes = await new Promise<WechatMiniprogram.LoginSuccessCallbackResult>((resolve, reject) => {
        wx.login({ success: resolve, fail: reject })
      })

      const res = await wechatLogin(loginRes.code)

      if (res.need_bind) {
        this.showNicknamePrompt(loginRes.code)
        return
      }

      if (!res.access_token) {
        this.setData({ error: "微信登录失败" })
        return
      }

      this.saveAndGo(res.access_token, res.role || "student", res.user_id || 0)
    } catch (e) {
      this.setData({ error: (e as Error).message || "微信登录失败" })
    } finally {
      this.setData({ loading: false })
    }
  },

  showNicknamePrompt(code: string) {
    wx.showModal({
      title: "设置昵称",
      editable: true,
      placeholderText: "请输入你的昵称",
      success: async (res) => {
        if (!res.confirm || !res.content?.trim()) {
          this.setData({ loading: false, error: "昵称不能为空" })
          return
        }
        try {
          const regRes = await wechatRegister({ code, display_name: res.content.trim() })
          this.saveAndGo(regRes.access_token, regRes.role, regRes.user_id)
        } catch (e) {
          this.setData({ loading: false, error: (e as Error).message || "注册失败" })
        }
      },
      fail: () => {
        this.setData({ loading: false })
      },
    })
  },

  async handleLogin() {
    const { username, password } = this.data
    if (!username.trim() || !password.trim()) {
      this.setData({ error: "请输入用户名和密码" })
      return
    }

    this.setData({ loading: true, error: "" })
    try {
      const res = await login({ username: username.trim(), password })
      this.saveAndGo(res.access_token, res.role, res.user_id)
    } catch (e) {
      this.setData({ error: (e as Error).message || "登录失败" })
    } finally {
      this.setData({ loading: false })
    }
  },

  saveAndGo(token: string, role: string, userId: number) {
    setToken(token)
    wx.setStorageSync("user_id", userId)
    wx.setStorageSync("role", role)
    app.globalData.token = token
    app.globalData.userId = userId
    app.globalData.role = role
    wx.switchTab({ url: "/pages/home/home" })
  },
})
```

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/login/
git commit -m "feat: redesign login page with WeChat login, Lottie animation, and mode toggle"
```

---

### Task 6: 创建「我的」页面

**Files:**
- Create: `miniprogram/pages/profile/profile.json`
- Create: `miniprogram/pages/profile/profile.wxml`
- Create: `miniprogram/pages/profile/profile.wxss`
- Create: `miniprogram/pages/profile/profile.ts`

- [ ] **Step 1: 创建 profile.json**

```json
{
  "navigationStyle": "custom",
  "usingComponents": {}
}
```

- [ ] **Step 2: 创建 profile.wxml**

```xml
<view class="page">
  <view class="header">我的</view>

  <view class="user-card">
    <view class="user-avatar">{{userInitial}}</view>
    <view class="user-info">
      <text class="user-name">{{displayName}}</text>
      <text class="user-role">{{roleLabel}}</text>
    </view>
  </view>

  <view class="menu-group">
    <view class="menu-item" bindtap="goToStats">
      <text class="menu-icon">📊</text>
      <text class="menu-label">训练统计</text>
      <text class="menu-arrow">›</text>
    </view>
    <view class="menu-item" bindtap="handleWechatBind">
      <text class="menu-icon">🔗</text>
      <text class="menu-label">微信绑定</text>
      <text class="menu-value {{wechatBound ? 'bound' : ''}}">
        {{wechatBound ? '已绑定' : '未绑定'}}
      </text>
      <text class="menu-arrow" wx:if="{{!wechatBound}}">›</text>
    </view>
    <view class="menu-item" bindtap="goToFeedback">
      <text class="menu-icon">💬</text>
      <text class="menu-label">意见反馈</text>
      <text class="menu-arrow">›</text>
    </view>
    <view class="menu-item" bindtap="goToAbout">
      <text class="menu-icon">ℹ️</text>
      <text class="menu-label">关于我们</text>
      <text class="menu-arrow">›</text>
    </view>
  </view>

  <view class="menu-group" wx:if="{{false}}">
    <view class="menu-item">
      <text class="menu-icon">⚙️</text>
      <text class="menu-label">设置</text>
      <text class="menu-arrow">›</text>
    </view>
  </view>

  <button class="logout-btn" bindtap="handleLogout">退出登录</button>
</view>
```

- [ ] **Step 3: 创建 profile.wxss**

```css
.page {
  padding: 24rpx;
  padding-top: 88rpx;
  padding-bottom: 48rpx;
  min-height: 100vh;
  background: var(--color-bg);
}

.header {
  font-size: var(--font-xl);
  font-weight: 700;
  margin-bottom: 24rpx;
}

.user-card {
  display: flex;
  align-items: center;
  gap: 24rpx;
  background: linear-gradient(135deg, #2563eb, #3b82f6);
  border-radius: var(--radius-lg);
  padding: 32rpx 28rpx;
  margin-bottom: 24rpx;
  box-shadow: 0 4rpx 20rpx rgba(37, 99, 235, 0.25);
}

.user-avatar {
  width: 88rpx;
  height: 88rpx;
  border-radius: 50%;
  background: rgba(255,255,255,0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
}

.user-info {
  flex: 1;
  min-width: 0;
}

.user-name {
  display: block;
  font-size: var(--font-lg);
  font-weight: 700;
  color: #fff;
}

.user-role {
  display: block;
  font-size: var(--font-xs);
  color: rgba(255,255,255,0.8);
  margin-top: 4rpx;
}

.menu-group {
  background: var(--color-card);
  border-radius: var(--radius-md);
  margin-bottom: 16rpx;
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 28rpx 24rpx;
  border-bottom: 1rpx solid var(--color-border);
}
.menu-item:last-child { border-bottom: none; }
.menu-item:active { background: #f9fafb; }

.menu-icon { font-size: 36rpx; flex-shrink: 0; }
.menu-label { flex: 1; font-size: var(--font-base); font-weight: 500; }
.menu-value {
  font-size: var(--font-sm);
  color: var(--color-text-secondary);
}
.menu-value.bound { color: #16a34a; }
.menu-arrow { font-size: 36rpx; color: var(--color-text-tertiary); }

.logout-btn {
  width: 100%;
  height: 88rpx;
  margin-top: 40rpx;
  background: #fff;
  color: #dc2626;
  border: 1rpx solid #fecaca;
  border-radius: var(--radius-md);
  font-size: var(--font-base);
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

- [ ] **Step 4: 创建 profile.ts**

```typescript
import { getMe, wechatBind } from "../../api/auth"
import { clearToken } from "../../utils/format"

const app = getApp<IAppOption>()

Page({
  data: {
    displayName: "",
    roleLabel: "",
    userInitial: "👤",
    wechatBound: false,
  },

  onShow() {
    this.loadProfile()
  },

  async loadProfile() {
    try {
      const profile = await getMe()
      this.setData({
        displayName: profile.display_name,
        roleLabel: profile.role === "teacher" ? "教师" : "学生",
        userInitial: profile.display_name?.charAt(0) || "👤",
      })
    } catch { /* ignore */ }

    this.checkWechatBound()
  },

  checkWechatBound() {
    // 尝试用微信登录判断是否已绑定
    wx.login({
      success: async (loginRes) => {
        try {
          const { wechatLogin } = await import("../../api/auth")
          const res = await wechatLogin(loginRes.code)
          this.setData({ wechatBound: !res.need_bind })
        } catch { /* ignore */ }
      },
    })
  },

  async handleWechatBind() {
    if (this.data.wechatBound) return

    const loginRes = await new Promise<WechatMiniprogram.LoginSuccessCallbackResult>((resolve, reject) => {
      wx.login({ success: resolve, fail: reject })
    })

    try {
      await wechatBind(loginRes.code)
      wx.showToast({ title: "绑定成功", icon: "success" })
      this.setData({ wechatBound: true })
    } catch (e) {
      wx.showToast({ title: (e as Error).message || "绑定失败", icon: "none" })
    }
  },

  goToStats() {
    wx.navigateTo({ url: "/pages/history/history" })
  },

  goToFeedback() {
    wx.navigateTo({ url: "/pages/feedback/feedback" })
  },

  goToAbout() {
    wx.showModal({
      title: "关于我们",
      content: "虚拟患者训练系统\n护理病史采集技能训练平台\n版本: v1.0.0",
      showCancel: false,
    })
  },

  handleLogout() {
    wx.showModal({
      title: "退出登录",
      content: "确定要退出当前账号吗？",
      confirmColor: "#dc2626",
      success: (res) => {
        if (!res.confirm) return
        clearToken()
        app.globalData.token = ""
        app.globalData.userId = 0
        app.globalData.role = ""
        wx.reLaunch({ url: "/pages/login/login" })
      },
    })
  },
})
```

- [ ] **Step 5: Commit**

```bash
git add miniprogram/pages/profile/
git commit -m "feat: add profile page (我的) with user info, WeChat binding, and menu list"
```

---

### Task 7: 创建反馈页面

**Files:**
- Create: `miniprogram/pages/feedback/feedback.json`
- Create: `miniprogram/pages/feedback/feedback.wxml`
- Create: `miniprogram/pages/feedback/feedback.wxss`
- Create: `miniprogram/pages/feedback/feedback.ts`
- Create: `miniprogram/api/feedback.ts`

- [ ] **Step 1: 创建 feedback API**

Create `miniprogram/api/feedback.ts`:
```typescript
import { post } from "./client"

export function submitFeedback(data: { rating: number; tag: string; content?: string }) {
  return post<{ id: number; created_at: string }>("/api/feedback", data as unknown as Record<string, unknown>)
}
```

- [ ] **Step 2: 创建 feedback.json**

```json
{
  "navigationStyle": "custom",
  "usingComponents": {}
}
```

- [ ] **Step 3: 创建 feedback.wxml**

```xml
<view class="page">
  <view class="header">意见反馈</view>

  <view class="section">
    <text class="section-title">评分</text>
    <view class="star-row">
      <text
        wx:for="{{stars}}"
        wx:key="*this"
        class="star {{item <= rating ? 'active' : ''}}"
        data-value="{{item}}"
        bindtap="setRating"
      >★</text>
    </view>
  </view>

  <view class="section">
    <text class="section-title">反馈类型</text>
    <view class="tag-row">
      <text
        wx:for="{{tags}}"
        wx:key="*this"
        class="tag {{tag === item ? 'active' : ''}}"
        data-tag="{{item}}"
        bindtap="setTag"
      >{{item}}</text>
    </view>
  </view>

  <view class="section">
    <text class="section-title">详细描述（选填）</text>
    <textarea
      class="textarea"
      placeholder="请描述你的使用体验或建议..."
      value="{{content}}"
      bindinput="onContentInput"
      maxlength="500"
      auto-height
    />
    <text class="char-count">{{content.length}}/500</text>
  </view>

  <button class="submit-btn" bindtap="handleSubmit" loading="{{submitting}}" disabled="{{submitting || !rating || !tag}}">
    {{submitting ? '提交中...' : '提交反馈'}}
  </button>
</view>
```

- [ ] **Step 4: 创建 feedback.wxss**

```css
.page {
  padding: 24rpx;
  padding-top: 88rpx;
  padding-bottom: 48rpx;
  min-height: 100vh;
  background: var(--color-bg);
}

.header {
  font-size: var(--font-xl);
  font-weight: 700;
  margin-bottom: 32rpx;
}

.section {
  margin-bottom: 32rpx;
}

.section-title {
  display: block;
  font-size: var(--font-sm);
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: 16rpx;
}

.star-row {
  display: flex;
  gap: 12rpx;
}

.star {
  font-size: 52rpx;
  color: #d1d5db;
  transition: color 0.2s;
}

.star.active {
  color: #f59e0b;
}

.tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.tag {
  padding: 12rpx 24rpx;
  border: 1rpx solid var(--color-border);
  border-radius: 40rpx;
  font-size: var(--font-sm);
  color: var(--color-text-secondary);
  background: var(--color-card);
}

.tag.active {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
}

.textarea {
  width: 100%;
  min-height: 160rpx;
  background: var(--color-card);
  border-radius: var(--radius-md);
  padding: 20rpx;
  font-size: var(--font-sm);
  box-sizing: border-box;
  box-shadow: var(--shadow-sm);
}

.char-count {
  display: block;
  text-align: right;
  font-size: var(--font-xs);
  color: var(--color-text-tertiary);
  margin-top: 8rpx;
}

.submit-btn {
  width: 100%;
  height: 88rpx;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-base);
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 16rpx;
}
.submit-btn[disabled] { opacity: 0.5; }
```

- [ ] **Step 5: 创建 feedback.ts**

```typescript
import { submitFeedback } from "../../api/feedback"

const TAGS = ["功能建议", "界面体验", "训练内容", "评分反馈", "Bug报告", "其他"]

Page({
  data: {
    stars: [1, 2, 3, 4, 5],
    rating: 0,
    tags: TAGS,
    tag: "",
    content: "",
    submitting: false,
  },

  setRating(e: WechatMiniprogram.TouchEvent) {
    this.setData({ rating: Number(e.currentTarget.dataset.value) })
  },

  setTag(e: WechatMiniprogram.TouchEvent) {
    const t = e.currentTarget.dataset.tag as string
    this.setData({ tag: this.data.tag === t ? "" : t })
  },

  onContentInput(e: WechatMiniprogram.Input) {
    this.setData({ content: e.detail.value })
  },

  async handleSubmit() {
    if (!this.data.rating || !this.data.tag) return
    this.setData({ submitting: true })
    try {
      await submitFeedback({
        rating: this.data.rating,
        tag: this.data.tag,
        content: this.data.content || undefined,
      })
      wx.showToast({ title: "感谢反馈！", icon: "success" })
      setTimeout(() => wx.navigateBack(), 1500)
    } catch {
      wx.showToast({ title: "提交失败", icon: "none" })
    } finally {
      this.setData({ submitting: false })
    }
  },
})
```

- [ ] **Step 6: Commit**

```bash
git add miniprogram/pages/feedback/ miniprogram/api/feedback.ts
git commit -m "feat: add feedback page with star rating, tags, and text input"
```

---

### Task 8: 全局 UI 视觉升级

**Files:**
- Modify: `miniprogram/app.wxss`
- Modify: `miniprogram/pages/home/home.wxml`
- Modify: `miniprogram/pages/home/home.wxss`
- Modify: `miniprogram/pages/cases/cases.wxml`
- Modify: `miniprogram/pages/cases/cases.wxss`
- Modify: `miniprogram/pages/history/history.wxml`
- Modify: `miniprogram/pages/history/history.wxss`
- Modify: `miniprogram/pages/training/training.wxml`
- Modify: `miniprogram/pages/training/training.wxss`
- Modify: `miniprogram/pages/record-detail/record-detail.wxml`
- Modify: `miniprogram/pages/record-detail/record-detail.wxss`

- [ ] **Step 1: 增强全局 app.wxss 设计令牌**

Replace `miniprogram/app.wxss`:
```css
page {
  --color-primary: #2563eb;
  --color-primary-light: #3b82f6;
  --color-primary-dark: #1d4ed8;
  --color-primary-bg: #eff6ff;
  --color-bg: #f5f6f8;
  --color-card: #ffffff;
  --color-text: #111827;
  --color-text-secondary: #6b7280;
  --color-text-tertiary: #9ca3af;
  --color-border: #e5e7eb;
  --color-success: #16a34a;
  --color-warning: #d97706;
  --color-danger: #dc2626;
  --color-blue-bg: #eff6ff;
  --radius-sm: 8rpx;
  --radius-md: 12rpx;
  --radius-lg: 16rpx;
  --radius-xl: 20rpx;
  --radius-full: 999rpx;
  --shadow-sm: 0 2rpx 8rpx rgba(0, 0, 0, 0.04);
  --shadow-md: 0 4rpx 16rpx rgba(0, 0, 0, 0.06);
  --shadow-lg: 0 8rpx 24rpx rgba(0, 0, 0, 0.08);
  --font-xs: 22rpx;
  --font-sm: 26rpx;
  --font-base: 28rpx;
  --font-lg: 32rpx;
  --font-xl: 36rpx;
  --font-2xl: 44rpx;
  background-color: var(--color-bg);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: var(--font-base);
  color: var(--color-text);
  line-height: 1.6;
  box-sizing: border-box;
}

.container { padding: 24rpx; }
.card {
  background: var(--color-card);
  border-radius: var(--radius-lg);
  padding: 24rpx;
  box-shadow: var(--shadow-sm);
}
.text-secondary { color: var(--color-text-secondary); }
.text-tertiary { color: var(--color-text-tertiary); }
```

- [ ] **Step 2: 优化首页视觉**

Replace `miniprogram/pages/home/home.wxml`:
```xml
<view class="page">
  <view class="header">
    <view class="header-greeting">
      <text class="greeting-text">你好，{{userName || '同学'}}</text>
      <text class="greeting-sub">今天开始新的训练吧</text>
    </view>
  </view>

  <view class="stats-row">
    <view class="stat-item">
      <text class="stat-value">{{totalSessions}}</text>
      <text class="stat-label">训练次数</text>
    </view>
    <view class="stat-item">
      <text class="stat-value">{{totalMinutes}}</text>
      <text class="stat-label">累计分钟</text>
    </view>
    <view class="stat-item">
      <text class="stat-value">{{avgScore}}</text>
      <text class="stat-label">平均得分</text>
    </view>
  </view>

  <view class="section">
    <view class="section-header">
      <text class="section-title">快速开始</text>
    </view>
    <view class="action-card" bindtap="goToCases">
      <view class="action-left">
        <view class="action-icon-wrap">
          <text class="action-icon">🩺</text>
        </view>
        <view>
          <text class="action-title">开始新训练</text>
          <text class="action-desc">选择病例，与虚拟患者对话</text>
        </view>
      </view>
      <text class="action-arrow">›</text>
    </view>
  </view>

  <view class="section" wx:if="{{recommendedCases.length > 0}}">
    <view class="section-header">
      <text class="section-title">推荐病例</text>
    </view>
    <view
      class="case-row"
      wx:for="{{recommendedCases}}"
      wx:key="id"
      bindtap="goToCases"
    >
      <view class="case-badge case-badge-{{item.difficulty}}">
        {{item.difficulty === 1 ? '★☆☆' : item.difficulty === 2 ? '★★☆' : '★★★'}}
      </view>
      <view class="case-info">
        <text class="case-name">{{item.name}}</text>
        <text class="case-desc">{{item.description}}</text>
      </view>
      <text class="case-arrow">›</text>
    </view>
  </view>

  <view class="section" wx:if="{{recentRecords.length > 0}}">
    <view class="section-header">
      <text class="section-title">最近训练</text>
    </view>
    <view
      class="record-row"
      wx:for="{{recentRecords}}"
      wx:key="id"
      bindtap="goToRecord"
      data-id="{{item.id}}"
    >
      <view class="record-icon">
        <text>📋</text>
      </view>
      <view class="record-info">
        <text class="record-name">{{item.case_name}}</text>
        <text class="record-time">{{item.timeLabel}}</text>
      </view>
      <view class="record-right">
        <text class="record-score {{item.scoreLabel && item.scoreLabel.color === '#16a34a' ? 'text-green' : item.scoreLabel && item.scoreLabel.color === '#dc2626' ? 'text-red' : 'text-amber'}}" wx:if="{{item.score_total != null}}">
          {{item.score_total}}分
        </text>
        <text class="record-status text-secondary" wx:else>{{item.status === 'in_progress' ? '进行中' : '未评分'}}</text>
        <text class="record-arrow">›</text>
      </view>
    </view>
  </view>

  <view class="empty" wx:if="{{!loading && recentRecords.length === 0}}">
    <view class="empty-icon-wrap">
      <text class="empty-icon">📋</text>
    </view>
    <text class="empty-text">暂无训练记录</text>
    <text class="empty-desc">开始你的第一次模拟训练吧</text>
  </view>
</view>
```

Replace `miniprogram/pages/home/home.wxss`:
```css
.page {
  padding: 24rpx;
  padding-top: max(env(safe-area-inset-top), 88rpx);
  padding-bottom: 24rpx;
}

.header {
  margin-bottom: 28rpx;
}

.header-greeting {
  padding: 4rpx 0;
}

.greeting-text {
  display: block;
  font-size: var(--font-2xl);
  font-weight: 800;
  color: var(--color-text);
}

.greeting-sub {
  display: block;
  font-size: var(--font-sm);
  color: var(--color-text-secondary);
  margin-top: 4rpx;
}

.stats-row {
  display: flex;
  gap: 16rpx;
  margin-bottom: 32rpx;
}

.stat-item {
  flex: 1;
  background: var(--color-card);
  border-radius: var(--radius-lg);
  padding: 28rpx 12rpx;
  text-align: center;
  box-shadow: var(--shadow-sm);
}

.stat-value {
  display: block;
  font-size: var(--font-2xl);
  font-weight: 800;
  color: var(--color-primary);
}

.stat-label {
  display: block;
  font-size: var(--font-xs);
  color: var(--color-text-secondary);
  margin-top: 6rpx;
}

.section {
  margin-bottom: 32rpx;
}

.section-header {
  margin-bottom: 16rpx;
}

.section-title {
  font-size: var(--font-base);
  font-weight: 700;
  color: var(--color-text);
}

.action-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--color-card);
  border-radius: var(--radius-lg);
  padding: 28rpx 24rpx;
  box-shadow: var(--shadow-sm);
  border: 1rpx solid var(--color-border);
}

.action-card:active { background: #f9fafb; }

.action-left {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.action-icon-wrap {
  width: 72rpx;
  height: 72rpx;
  border-radius: var(--radius-md);
  background: var(--color-primary-bg);
  display: flex;
  align-items: center;
  justify-content: center;
}

.action-icon { font-size: 40rpx; }

.action-title {
  display: block;
  font-size: var(--font-base);
  font-weight: 700;
}

.action-desc {
  display: block;
  font-size: var(--font-xs);
  color: var(--color-text-secondary);
}

.action-arrow {
  font-size: 40rpx;
  color: var(--color-text-tertiary);
}

.case-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  background: var(--color-card);
  border-radius: var(--radius-md);
  padding: 24rpx;
  margin-bottom: 12rpx;
  box-shadow: var(--shadow-sm);
}

.case-row:active { background: #f9fafb; }

.case-badge {
  font-size: 20rpx;
  font-weight: 600;
  padding: 4rpx 12rpx;
  border-radius: 20rpx;
  flex-shrink: 0;
}

.case-badge-1 { background: #dcfce7; color: #16a34a; }
.case-badge-2 { background: #fef3c7; color: #d97706; }
.case-badge-3 { background: #fee2e2; color: #dc2626; }

.case-info { flex: 1; min-width: 0; }

.case-name {
  display: block;
  font-size: var(--font-sm);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.case-desc {
  display: block;
  font-size: var(--font-xs);
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.case-arrow {
  font-size: 32rpx;
  color: var(--color-text-tertiary);
}

.record-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  background: var(--color-card);
  border-radius: var(--radius-md);
  padding: 24rpx;
  margin-bottom: 12rpx;
  box-shadow: var(--shadow-sm);
}

.record-row:active { background: #f9fafb; }

.record-icon {
  width: 64rpx;
  height: 64rpx;
  border-radius: var(--radius-sm);
  background: #f3f4f6;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28rpx;
  flex-shrink: 0;
}

.record-info { flex: 1; min-width: 0; }

.record-name {
  display: block;
  font-size: var(--font-sm);
  font-weight: 600;
}

.record-time {
  display: block;
  font-size: var(--font-xs);
  color: var(--color-text-tertiary);
  margin-top: 4rpx;
}

.record-right {
  display: flex;
  align-items: center;
  gap: 8rpx;
}

.record-score {
  font-size: var(--font-sm);
  font-weight: 700;
}

.record-status {
  font-size: var(--font-xs);
}

.record-arrow {
  font-size: 32rpx;
  color: var(--color-text-tertiary);
}

.text-green { color: #16a34a; }
.text-red { color: #dc2626; }
.text-amber { color: #d97706; }

.empty {
  text-align: center;
  padding: 80rpx 0;
}

.empty-icon-wrap {
  width: 120rpx;
  height: 120rpx;
  border-radius: 50%;
  background: #f3f4f6;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 24rpx;
}

.empty-icon { font-size: 56rpx; }

.empty-text {
  display: block;
  font-size: var(--font-base);
  color: var(--color-text-secondary);
  font-weight: 600;
}

.empty-desc {
  display: block;
  font-size: var(--font-xs);
  color: var(--color-text-tertiary);
  margin-top: 8rpx;
}
```

Update `miniprogram/pages/home/home.ts` to load user name:

In `loadData()`, add a call to `getMe()`:
```typescript
// Add import at top:
import { getMe } from "../../api/auth"

// In loadData(), add getMe to Promise.all:
const [duration, trends, cases, records, me] = await Promise.all([
  getDurationStats("month").catch(() => null),
  getTrends("month").catch(() => null),
  getCases({ limit: 5 }).catch(() => null),
  getRecords({ limit: 5 }).catch(() => null),
  getMe().catch(() => null),
])

// In setData, add:
userName: me?.display_name || "",
```

- [ ] **Step 3: 优化病例页视觉**

Replace `miniprogram/pages/cases/cases.wxss`:
```css
.page {
  padding: 24rpx;
  padding-top: max(env(safe-area-inset-top), 88rpx);
}

.header {
  font-size: var(--font-2xl);
  font-weight: 800;
  margin-bottom: 24rpx;
}

.filter-bar {
  display: flex;
  gap: 16rpx;
  white-space: nowrap;
  margin-bottom: 24rpx;
}

.filter-chip {
  display: inline-block;
  padding: 12rpx 28rpx;
  border: 1rpx solid var(--color-border);
  border-radius: 40rpx;
  font-size: var(--font-sm);
  color: var(--color-text-secondary);
  background: var(--color-card);
  font-weight: 500;
}

.filter-chip.active {
  background: var(--color-primary);
  color: #fff;
  border-color: var(--color-primary);
  font-weight: 600;
}

.case-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

.case-card {
  background: var(--color-card);
  border-radius: var(--radius-lg);
  padding: 28rpx;
  box-shadow: var(--shadow-sm);
  border: 1rpx solid var(--color-border);
}

.case-badge {
  display: inline-block;
  font-size: 20rpx;
  font-weight: 600;
  padding: 6rpx 16rpx;
  border-radius: 20rpx;
  margin-bottom: 12rpx;
}

.case-badge-1 { background: #dcfce7; color: #16a34a; }
.case-badge-2 { background: #fef3c7; color: #d97706; }
.case-badge-3 { background: #fee2e2; color: #dc2626; }

.case-name {
  display: block;
  font-size: var(--font-lg);
  font-weight: 700;
  margin-bottom: 8rpx;
}

.case-desc {
  display: block;
  font-size: var(--font-sm);
  color: var(--color-text-secondary);
  line-height: 1.6;
  margin-bottom: 20rpx;
}

.case-btn {
  width: 100%;
  height: 76rpx;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--font-sm);
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty {
  text-align: center;
  padding: 120rpx 0;
  font-size: var(--font-sm);
  color: var(--color-text-secondary);
}
```

- [ ] **Step 4: 优化训练页视觉**

Replace `miniprogram/pages/training/training.wxss`:
```css
.page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--color-bg);
}

.topbar {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 16rpx 20rpx;
  padding-top: max(env(safe-area-inset-top), 44rpx);
  background: var(--color-card);
  border-bottom: 1rpx solid var(--color-border);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.back-btn {
  font-size: 40rpx;
  padding: 8rpx 12rpx;
  color: var(--color-text-secondary);
  font-weight: 300;
}

.patient-info { flex: 1; min-width: 0; }
.patient-name { display: block; font-size: var(--font-sm); font-weight: 700; }
.case-title { display: block; font-size: 20rpx; color: var(--color-text-secondary); }

.timer {
  font-size: var(--font-sm);
  font-weight: 600;
  color: var(--color-text-secondary);
  background: #f3f4f6;
  padding: 8rpx 16rpx;
  border-radius: 8rpx;
}

.timer-warn { color: #dc2626; background: #fef2f2; }

.end-btn {
  background: var(--color-danger);
  color: #fff;
  padding: 10rpx 24rpx;
  border-radius: 8rpx;
  font-size: var(--font-xs);
  font-weight: 600;
}

.chat-area { flex: 1; padding: 24rpx; }
.msg-row { display: flex; margin-bottom: 24rpx; }
.msg-left { justify-content: flex-start; }
.msg-right { justify-content: flex-end; }

.msg-bubble {
  max-width: 78%;
  padding: 18rpx 24rpx;
  border-radius: 20rpx;
  font-size: var(--font-base);
  line-height: 1.6;
  word-break: break-all;
}

.bubble-patient {
  background: var(--color-card);
  border: 1rpx solid var(--color-border);
  border-bottom-left-radius: 6rpx;
  box-shadow: var(--shadow-sm);
}

.bubble-student {
  background: var(--color-primary);
  color: #fff;
  border-bottom-right-radius: 6rpx;
  box-shadow: 0 2rpx 8rpx rgba(37, 99, 235, 0.25);
}

.input-bar {
  display: flex;
  align-items: center;
  gap: 12rpx;
  padding: 16rpx 20rpx;
  padding-bottom: max(env(safe-area-inset-bottom), 16rpx);
  background: var(--color-card);
  border-top: 1rpx solid var(--color-border);
  flex-shrink: 0;
}

.chat-input {
  flex: 1;
  height: 76rpx;
  background: #f3f4f6;
  border-radius: 40rpx;
  padding: 0 24rpx;
  font-size: var(--font-base);
}

.send-btn {
  width: 120rpx;
  height: 76rpx;
  background: var(--color-primary);
  color: #fff;
  border: none;
  border-radius: 40rpx;
  font-size: var(--font-sm);
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.send-btn[disabled] { opacity: 0.4; }

.score-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.score-card {
  background: var(--color-card);
  border-radius: var(--radius-xl);
  padding: 64rpx 48rpx;
  text-align: center;
  width: 540rpx;
  box-shadow: var(--shadow-lg);
}

.score-title { display: block; font-size: var(--font-base); font-weight: 600; margin-bottom: 16rpx; }
.score-total { display: block; font-size: 100rpx; font-weight: 800; color: var(--color-primary); }
.score-label { display: block; font-size: var(--font-sm); color: var(--color-text-secondary); margin-bottom: 36rpx; }
.score-close {
  background: var(--color-primary); color: #fff; border: none;
  border-radius: var(--radius-md); font-size: var(--font-base); font-weight: 600;
  width: 100%; height: 80rpx; display: flex; align-items: center; justify-content: center;
}
```

- [ ] **Step 5: 优化记录页视觉**

Replace `miniprogram/pages/history/history.wxss`:
```css
.page {
  padding: 24rpx;
  padding-top: max(env(safe-area-inset-top), 88rpx);
}

.header {
  font-size: var(--font-2xl);
  font-weight: 800;
  margin-bottom: 24rpx;
}

.filter-bar { display: flex; gap: 16rpx; white-space: nowrap; margin-bottom: 24rpx; }
.filter-chip {
  display: inline-block; padding: 12rpx 28rpx; border: 1rpx solid var(--color-border);
  border-radius: 40rpx; font-size: var(--font-sm); color: var(--color-text-secondary);
  background: var(--color-card); font-weight: 500;
}
.filter-chip.active {
  background: var(--color-primary); color: #fff; border-color: var(--color-primary); font-weight: 600;
}

.record-list { display: flex; flex-direction: column; gap: 16rpx; }
.record-row {
  display: flex; align-items: center; justify-content: space-between;
  background: var(--color-card); border-radius: var(--radius-md);
  padding: 24rpx; box-shadow: var(--shadow-sm);
}
.record-row:active { background: #f9fafb; }
.record-info { flex: 1; min-width: 0; }
.record-name { display: block; font-size: var(--font-sm); font-weight: 600; }
.record-time { display: block; font-size: var(--font-xs); color: var(--color-text-tertiary); margin-top: 4rpx; }
.record-right { display: flex; align-items: center; gap: 12rpx; }
.record-score { font-size: var(--font-xs); font-weight: 600; }
.record-status { font-size: var(--font-xs); color: var(--color-text-secondary); }
.record-del { font-size: 40rpx; color: #dc2626; padding: 0 8rpx; }

.empty { text-align: center; padding: 120rpx 0; font-size: var(--font-sm); color: var(--color-text-secondary); }
.empty text:first-child { font-size: 72rpx; display: block; margin-bottom: 16rpx; }
```

- [ ] **Step 6: 优化记录详情页视觉**

Replace `miniprogram/pages/record-detail/record-detail.wxss`:
```css
.page {
  padding: 24rpx;
  padding-top: max(env(safe-area-inset-top), 88rpx);
  padding-bottom: 48rpx;
}

.header {
  font-size: var(--font-2xl);
  font-weight: 800;
  margin-bottom: 24rpx;
}

.info-card {
  background: var(--color-card); border-radius: var(--radius-lg); padding: 28rpx;
  box-shadow: var(--shadow-sm); margin-bottom: 28rpx;
}

.info-name { display: block; font-size: var(--font-lg); font-weight: 700; }
.info-time { display: block; font-size: var(--font-xs); color: var(--color-text-tertiary); margin-top: 8rpx; }
.info-status {
  display: inline-block; margin-top: 12rpx; font-size: var(--font-xs); font-weight: 600;
  padding: 6rpx 16rpx; border-radius: 20rpx; background: var(--color-primary-bg); color: var(--color-primary);
}

.score-section { margin-bottom: 32rpx; }

.score-hero {
  text-align: center; padding: 48rpx 0; background: var(--color-card);
  border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); margin-bottom: 20rpx;
}

.score-num { display: block; font-size: 100rpx; font-weight: 800; }
.score-grade { display: block; font-size: var(--font-sm); color: var(--color-text-secondary); margin-top: 8rpx; }

.score-bars {
  background: var(--color-card); border-radius: var(--radius-md);
  padding: 24rpx; box-shadow: var(--shadow-sm);
}

.score-bar-item { margin-bottom: 20rpx; }
.score-bar-item:last-child { margin-bottom: 0; }
.score-bar-header { display: flex; justify-content: space-between; font-size: var(--font-xs); margin-bottom: 8rpx; }
.score-bar-track { height: 12rpx; background: #f3f4f6; border-radius: 6rpx; overflow: hidden; }
.score-bar-fill { height: 100%; border-radius: 6rpx; transition: width 0.6s; }

.section { margin-bottom: 28rpx; }
.section-title { font-size: var(--font-sm); font-weight: 700; margin-bottom: 12rpx; }
.list-item {
  font-size: var(--font-xs); color: var(--color-text-secondary); padding: 14rpx 16rpx;
  background: var(--color-card); border-radius: var(--radius-sm); margin-bottom: 8rpx; box-shadow: var(--shadow-sm);
}

.replay-msg { font-size: var(--font-sm); padding: 18rpx; border-radius: var(--radius-sm); margin-bottom: 12rpx; line-height: 1.6; }
.replay-msg.patient { background: #f3f4f6; border-left: 4rpx solid var(--color-border); }
.replay-msg.student { background: var(--color-primary-bg); color: var(--color-primary); border-left: 4rpx solid var(--color-primary); }

.text-secondary { color: var(--color-text-secondary); font-size: var(--font-sm); }
.empty { text-align: center; padding: 120rpx 0; color: var(--color-text-secondary); }
```

- [ ] **Step 7: Commit**

```bash
git add miniprogram/app.wxss miniprogram/pages/home/ miniprogram/pages/cases/cases.wxss miniprogram/pages/history/history.wxss miniprogram/pages/training/training.wxss miniprogram/pages/record-detail/record-detail.wxss
git commit -m "feat: global UI polish for all pages with enhanced design tokens and visual hierarchy"
```

---

## Self-Review Checklist

1. **Spec coverage:** All spec requirements covered - wechat register (Task1), Lottie login (Task2+5), tabBar (Task3), profile page (Task6), feedback page (Task7), UI polish (Task8), auth API (Task4).
2. **No placeholders:** All code is complete, no TBD/TODO, no "add appropriate error handling" without specifics.
3. **Type consistency:** `WechatRegisterRequest` defined in Task1 schemas, used consistently in Task1 auth and Task4 API. `lottie-player` component props match WXML usage. Tab page paths match app.json config.

---

## Execution Handoff

计划已保存至 `docs/superpowers/plans/2026-06-04-miniprogram-ui-wechat.md`。两种执行方式：

**1. Subagent-Driven（推荐）** — 每个 Task 分配一个 subagent 独立执行，review 后再继续

**2. Inline Execution** — 在当前 session 中按 Task 逐步执行，分批提交

选择哪种方式？
