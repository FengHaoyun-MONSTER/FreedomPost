# FreedomPost “站长福利”详细设计

状态：已批准，进入实施
设计版本：1.0
涉及仓库：`freedompost`、`Opus8-CF`

实施进度：

- P1-1 已完成：FreedomPost 到 Opus8 的 HMAC 请求鉴权及安全回归测试。
- P1-2 已完成：固定套餐构造、D1 原子创建、串行与并发幂等测试。
- P1-3 已完成：专用 HTTP 路由、字段白名单、策略发布和本地 D1 端到端测试。
- P2-1 已完成：PostgreSQL schema、`0009` 迁移、Memory/PostgreSQL Repository 与状态机测试。
- P2-2 已完成：FreedomPost 到 Opus8 的 HMAC 签名客户端、配置校验、全阶段超时、错误归一化和同一外部领取 ID 幂等恢复测试。
- P2-3 已完成：Turnstile 服务端验证及幂等重试、Redis 原子限流及保守降级、签名领取 Cookie 与脱敏浏览器/网络摘要。
- P2-4 已完成：公开 API、领取状态机及崩溃恢复、AES-256-GCM 订阅地址加密、运行时 fail-closed 配置、CORS/日志脱敏和可信代理边界。
- P3-1 已完成：导航和首页入口已替换为“站长福利”，新增 `/benefit/` 页面骨架，`/topics/` 保留 301 兼容跳转，sitemap 改为 canonical 福利页。
- P3-2 已完成：福利领取页面、同源活动/恢复/领取 API 客户端、Turnstile 显式渲染、领取状态与安全轮询、浏览器本地二维码及复制/下载操作。
- P3-3 已完成：福利脚本按需加载，Portal 局部导航进入/离开时统一初始化和清理请求、轮询及 Turnstile；同步页面元数据与焦点，并补齐无障碍、窄屏和减少动画回归测试。
- P4-1 已完成：Opus8 边缘用量按剩余额度自适应聚合，保持会话本地额度拦截；控制面将单批幂等事件合并写入小时汇总，并修复准入续租重复计算本会话已上报字节的问题。
- 已完成：P4-2 Caddy/CSP、环境变量、workflow、两端 secret 预检和部署健康检查修正。
- 下一任务：P4-3 staging 端到端测试、故障恢复演练和正式发布。

## 1. 目标与边界

在 FreedomPost 公共网站中，将现有“专题”入口替换为“站长福利”。访客通过一次人机验证领取固定套餐，页面展示可由代理客户端导入的订阅二维码。

固定套餐由 Opus8 服务端定义，任何浏览器请求均不能覆盖：

- 流量：30 GiB，即 `32_212_254_720` 字节。
- 有效期：从成功创建时起 15 天。
- 设备凭据：静态 UUID。
- HWID：强制，首次合法订阅请求绑定。
- 设备数：1。
- 五分钟活跃公网 IP：2。
- 24 小时公网 IP：2。
- 落地解锁：默认关闭。
- 节点范围：创建时的默认健康节点策略。

本期不包含支付、邀请裂变、邮件/Telegram/企业微信通知、在 FreedomPost 中复制 Opus8 流量明细、动态 UUID、前端可配置套餐参数。

## 2. 部署与运行架构

FreedomPost 继续部署在现有独立 VPS：Caddy 提供 Astro 静态文件，Fastify 提供同源 API，PostgreSQL 保存领取状态，Redis 承担短期限流与防重放。普通页面访问不经过 Cloudflare Workers/Pages。

仅在领取进入 `provisioning` 状态时，FreedomPost Fastify 才向 Opus8 控制面发起一次服务端签名请求。客户端后续订阅下载和节点使用仍由 Opus8 负责。

```text
浏览器 -> Caddy 静态页面
浏览器 -> FreedomPost Fastify -> Turnstile
                              -> Redis 限流
                              -> PostgreSQL 领取状态
                              -> Opus8 固定套餐集成接口 -> D1
客户端 -------------------------------------------> Opus8 订阅接口
```

## 3. 信任边界

### 3.1 浏览器到 FreedomPost

- 只调用同源 `/api/benefits/webmaster/*`。
- `POST /claim` 必须提交 Turnstile token。
- 领取结果通过签名的 `HttpOnly; Secure; SameSite=Lax` Cookie 恢复。
- 浏览器不接触 Opus8 管理密码、API Token、集成密钥或数据库标识。
- 二维码在浏览器本地生成，不把订阅地址发送给第三方二维码 API。

### 3.2 FreedomPost 到 Opus8

- 使用独立集成密钥，不复用管理员 JWT、管理员密码或节点 HMAC 密钥。
- HMAC 签名绑定版本、时间戳、请求 ID、HTTP 方法、路径和原始请求体。
- 时间窗默认 5 分钟。
- `request_id` 和 `external_claim_id` 都必须具备重放/幂等保护。
- Opus8 接口忽略并拒绝套餐覆盖字段；固定套餐只在 Opus8 代码中定义。

签名规范：

```text
opus8-integration-v1\n
<timestamp-ms>\n
<request-id>\n
<METHOD>\n
<pathname-and-query>\n
<sha256-hex(raw-body)>
```

请求头：

```text
X-Opus8-Integration-Key-Id
X-Opus8-Integration-Timestamp
X-Opus8-Integration-Request-Id
X-Opus8-Integration-Signature
```

## 4. API 契约

### 4.1 FreedomPost 公共接口

#### `GET /api/benefits/webmaster`

返回公开活动信息，不包含订阅地址：

```json
{
  "id": "webmaster-benefit-v1",
  "enabled": true,
  "trafficBytes": 32212254720,
  "durationDays": 15,
  "hwidRequired": true,
  "ipLimit": 2,
  "turnstileSiteKey": "公开的 Turnstile site key；活动运行时未配置则为 null"
}
```

#### `POST /api/benefits/webmaster/claim`

请求：

```json
{
  "turnstileToken": "..."
}
```

响应状态：

- `201 ready`：本次创建成功。
- `200 ready`：幂等恢复已有结果。
- `202 provisioning`：Opus8 结果尚未确认，客户端轮询恢复接口。
- `400`：请求格式错误。
- `403`：Turnstile 无效或活动关闭。
- `409`：领取状态冲突且不能自动恢复。
- `429`：触发限流。
- `503`：依赖暂时不可用，可使用同一领取凭证重试。

#### `GET /api/benefits/webmaster/claim`

使用签名 Cookie 恢复当前浏览器领取状态。没有领取凭证时返回 `404`。

所有领取响应必须包含 `Cache-Control: no-store`，日志必须对订阅 token、Cookie 和签名头脱敏。

### 4.2 Opus8 集成接口

#### `POST /api/integrations/freedompost/benefits/webmaster/claim`

唯一允许的业务请求体：

```json
{
  "externalClaimId": "UUID",
  "campaignId": "webmaster-benefit-v1"
}
```

明确拒绝 `trafficLimitBytes`、`durationDays`、`deviceLimit`、`ipLimit24h`、`hwidMode`、`unlock`、`nodeGroup` 等字段。

成功响应：

```json
{
  "externalClaimId": "UUID",
  "opusUserId": "...",
  "opusDeviceId": "...",
  "subscriptionUrl": "https://.../sub/...",
  "expiresAt": "ISO-8601",
  "trafficBytes": 32212254720,
  "hwidRequired": true,
  "ipLimit": 2,
  "created": true
}
```

同一个 `externalClaimId` 重试返回同一用户、设备和订阅地址，并将 `created` 设为 `false`。

## 5. 数据设计

### 5.1 FreedomPost PostgreSQL

迁移：`deploy/migrations/0009_benefit_claims.sql`

`benefit_campaigns`：

- `id varchar(64) primary key`
- `name text not null`
- `enabled boolean not null`
- `starts_at / ends_at timestamptz null`
- `created_at / updated_at timestamptz not null`

`benefit_claims`：

- `id uuid primary key`
- `campaign_id` 外键。
- `external_claim_id uuid unique not null`。
- `browser_key_hash varchar(128) not null`。
- `network_key_hash varchar(128) not null`，不保存原始 IP。
- `status varchar(16)`：`pending | provisioning | ready | failed | revoked | expired`。
- `opus_user_id / opus_device_id text null`。
- `subscription_url_enc text null`，使用独立密钥加密。
- `expires_at timestamptz null`。
- `attempt_count integer not null default 0`。
- `last_error_code varchar(64) null`，不保存含凭据的上游响应。
- `created_at / updated_at timestamptz not null`。

唯一约束和事务是最终幂等保障；Redis 只负责快速拒绝高频请求。

### 5.2 Opus8 D1

新增 `integration_claims`：

- `external_claim_id text primary key`
- `integration_id text not null`
- `campaign_id text not null`
- `user_id text unique not null`
- `device_id text unique not null`
- `created_at integer not null`

创建 `users`、`user_devices`、`user_limits` 和 `integration_claims` 必须放入同一个 D1 `batch`，避免出现只有部分资源成功的状态。订阅 URL 不在新表中重复保存，可通过设备 `sub_token` 确定性重建。

## 6. 状态机与故障恢复

```text
pending -> provisioning -> ready
                    \----> failed -> provisioning
ready -> revoked
ready -> expired
```

- PostgreSQL 先写 `pending`，再以同一 `external_claim_id` 调用 Opus8。
- 调用前切换为 `provisioning` 并增加 `attempt_count`。
- HTTP 超时视为“结果未知”，不得新建 claim；重试相同 `external_claim_id`。
- Opus8 的 D1 幂等记录决定是否已创建。
- 成功后加密保存订阅地址并写入 `ready`。
- 页面刷新从签名 Cookie 恢复，不再次申请。

## 7. 防刷策略

- Turnstile 必须由 Fastify 服务端验证 hostname、success 和 action。
- 浏览器领取凭证使用 256 位随机值，数据库只保存 HMAC。
- 同一浏览器同一活动最多一个有效领取。
- 同一网络默认 24 小时最多 3 次，作为可配置阈值，避免共享 NAT 误伤。
- 同一来源的 claim API 设置分钟级突发限制。
- Redis 不可用时进入保守降级：保留 PostgreSQL 唯一约束和较低的进程内限流，不绕过 Turnstile。
- 公开 API 的 CORS 仅允许站点自身来源；不沿用任意 Origin 反射策略。

## 8. 前端设计

### 8.1 路由

- 新增 canonical 页面 `/benefit/`。
- 导航 `topics` 改为 `benefit`，文本改为“站长福利”。
- 原 `/topics/` 保留兼容跳转，不直接删除历史地址。
- 首页快捷入口、sitemap 同步更新。

### 8.2 页面状态

- `idle`：展示套餐和领取按钮。
- `verifying`：Turnstile 校验中。
- `claiming`：正在领取，禁用重复点击。
- `provisioning`：显示安全重试/自动轮询状态。
- `ready`：显示二维码、复制按钮、到期时间和 HWID 提示。
- `error`：只展示可公开的错误码和恢复动作。

FreedomPost 的站内导航会替换 `#portalContent`，福利页面初始化必须接入 `bindPageInteractions()`，并保持可重复执行、无重复监听器。

## 9. 配置与部署

FreedomPost：

```text
REDIS_URL
TURNSTILE_SITE_KEY
TURNSTILE_SECRET_KEY
OPUS8_INTEGRATION_BASE_URL
OPUS8_INTEGRATION_KEY_ID
OPUS8_INTEGRATION_SECRET
BENEFIT_CLAIM_HMAC_SECRET
BENEFIT_LINK_ENCRYPTION_KEY
BENEFIT_NETWORK_DAILY_LIMIT
```

Opus8：

```text
FREEDOMPOST_INTEGRATION_KEY_ID
FREEDOMPOST_INTEGRATION_SECRET
```

Caddy CSP 增加 `https://challenges.cloudflare.com` 的 `script-src`、`frame-src` 和必要的 `connect-src`；福利 API 禁止缓存，静态页面维持短缓存。

## 10. 明确改动范围

### 10.1 Opus8-CF

新增：

- `packages/control-plane/src/integration-auth.ts`
- `packages/control-plane/src/webmaster-benefit.ts`
- `packages/control-plane/test/integration-auth-test.mjs`
- `packages/control-plane/test/webmaster-benefit-test.mjs`

修改：

- `packages/control-plane/src/db.ts`：Env 与幂等查询/批量创建。
- `packages/control-plane/src/index.ts`：专用集成路由。
- `packages/control-plane/schema.sql`：`integration_claims`。
- `packages/control-plane/package.json`：测试脚本。
- `packages/control-plane/wrangler.toml` 与部署工作流：新增 secret 名称检查，不写入明文。

不修改：

- 现有管理员登录方式。
- 现有 `/api/users` 请求/响应兼容性。
- 节点传输协议与节点 Worker 的 WebSocket 数据面。
- 已有用户及设备迁移策略。

### 10.2 FreedomPost

新增：

- `apps/public-reader/src/pages/benefit.astro`
- `apps/public-reader/src/scripts/benefit.ts`
- `apps/public-reader/src/styles/benefit.css`
- `apps/api/src/benefits/*`
- `apps/api/src/benefits/*.test.ts`
- `deploy/migrations/0009_benefit_claims.sql`

修改：

- `apps/public-reader/src/layouts/PortalShell.astro`
- `apps/public-reader/src/pages/index.astro`
- `apps/public-reader/src/pages/topics.astro`
- `apps/public-reader/src/pages/sitemap.xml.ts`
- `apps/public-reader/src/scripts/portal.ts`
- `apps/api/src/app.ts`
- `apps/api/src/repositories/types.ts`
- `apps/api/src/repositories/memory.ts`
- `apps/api/src/repositories/postgres.ts`
- `packages/db/src/schema.ts`
- `apps/api/package.json`、`apps/public-reader/package.json`、根 `package-lock.json`
- `.env.example`、`deploy/docker-compose.yml`、Caddy 配置、部署工作流。

现有未提交的 YouTube/媒体编辑改动属于用户工作，不覆盖、不回滚。依赖变更对 `package-lock.json` 的修改必须在现有版本上合并。

## 11. 测试与验收

### 11.1 安全契约

- 正确签名通过；错误 key、错误 body、错误 path、过期时间戳拒绝。
- 相同签名/request ID 重放不产生第二个用户。
- 套餐覆盖字段返回 `400`。
- FreedomPost 页面源码和网络响应不出现服务端密钥。
- 日志不出现完整订阅 URL、Cookie 或签名。

### 11.2 业务契约

- 套餐严格为 30 GiB/15 天/HWID required/IP 2/静态凭据。
- 同一 `external_claim_id` 并发只产生一个 D1 用户。
- 第一次订阅请求绑定 HWID；不同 HWID 返回 403。
- 页面刷新恢复同一二维码。
- Opus8 超时后重试能够恢复，不重复创建。
- 原 `/topics/` 可达并跳转到 `/benefit/`。

### 11.3 发布门槛

- 两个仓库 typecheck、unit tests、build 全部通过。
- 本地 D1 集成测试通过。
- staging 完成浏览器领取、客户端导入、HWID 绑定和 IP 限制手工测试。
- 活动具有服务端紧急关闭开关。

## 12. 开发任务计划

### P1 Opus8 安全集成基础

- **P1-1**：测试先行，实现集成 HMAC v1 的签名生成/验证、时间窗和常量时间比较。
- **P1-2**：D1 增加 `integration_claims`，实现固定套餐原子创建和 `external_claim_id` 幂等。
- **P1-3**：增加专用 HTTP 路由、固定字段校验、响应脱敏和本地 D1 集成测试。

### P2 FreedomPost 领取后端

- **P2-1**：PostgreSQL schema、迁移、Repository memory/postgres 测试。
- **P2-2**：Opus8 签名客户端和超时/幂等恢复测试。
- **P2-3**：Turnstile 服务端验证、Redis 限流和签名领取 Cookie。
- **P2-4**：公开 API、状态机、加密订阅地址和日志脱敏。

### P3 FreedomPost 页面

- **P3-1**：导航和路由替换、`/topics/` 兼容跳转、sitemap。
- **P3-2**：福利页面、Turnstile、领取状态、浏览器本地二维码。
- **P3-3**：接入 Portal 局部导航生命周期和无障碍/移动端测试。

### P4 容量与上线

- **P4-1**：Opus8 用量事件自适应聚合，保持额度硬限制。
- **P4-2**：Caddy/CSP/env/workflow 配置和 secret 预检。
- **P4-3**：staging 端到端测试、故障恢复演练、正式发布。

### P5 后续运营迭代

- FreedomPost Admin 活动开关和领取概览。
- 失败领取重试、吊销映射和审计事件。
- 多活动模板；仍由服务端固定套餐版本控制，不开放任意代理参数。
