# 付费文章与读者账号

## 边界与所有权

付费访问采用绞杀者迁移方式：现有 TypeScript API 继续负责文章编辑、评论、文件和管理员登录；`services/paid-access` Go 服务负责读者账号、持久会话、文章订单、阅读授权和审计。

- Caddy 仅将 `/api/reader/*` 暴露给 Go 服务。
- `/internal/*` 不经过 Caddy，只允许容器网络内的 TypeScript API 调用。
- 内部请求使用 `PAID_ACCESS_INTERNAL_SECRET` 计算带五分钟时间窗的 HMAC-SHA256，签名覆盖时间、方法、路径和请求体哈希。
- Go 服务不可用时，TypeScript API 对付费文章的评论、附件和访问计数检查默认拒绝。
- 原商城订单与文章订单分表；二者只复用交互样式和人工确认流程。

## 状态与事务

文章可见性为 `public | private | paid`。付费文章必须具有正整数分价格。

```text
pending ──> completed（终态，事务内授予永久权限）
   │
   └──────> canceled ──> pending
```

同一账号和文章最多存在一个待处理订单。确认成交时，订单更新、授权写入和审计日志位于同一串行化事务；重复确认保持幂等。已完成订单不能取消，避免产生已付款但权限被静默撤销的数据不一致。

## 身份与会话

- 登录名经过 Unicode NFKC、首尾空白清理和不区分大小写的唯一化；拒绝控制字符和不可见格式字符。
- 邮箱格式只是一种登录名，不验证，也不作为找回密码渠道。
- 密码允许任意字符，长度为 8–128 个 Unicode 字符，使用 Argon2id 加盐哈希。
- 会话令牌为 256 位随机值；浏览器只保存 `HttpOnly + Secure + SameSite=Lax` Cookie，数据库只保存 SHA-256 摘要。
- 服务端会话无固定绝对过期时间，Cookie 在有效访问时滚动续期。
- 退出、密码重置、凭据版本变化、账号禁用或管理员撤销会使会话失效。
- 管理员重置密码后，新随机密码只在响应中显示一次。

## Turnstile

注册和登录分别使用 `reader_register`、`reader_login` action。服务端校验成功状态、hostname、action、五分钟挑战时效和响应大小；临时网络错误最多重试一次并复用同一个 idempotency key。验证服务不可用时失败关闭。

## 防复制边界

已授权付费正文启用选择、复制、剪切、右键、拖拽、常见复制/保存/打印快捷键限制和打印隐藏，并显示授权水印。该能力是浏览器侧的阻碍措施，无法阻止截图、拍照、OCR、开发者工具或已授权用户人工转录；真正的权限边界始终是服务端不向未授权账号返回正文。

## 配置与发布

必要配置见根目录 `.env.example`。生产发布还需要独立的 GitHub Actions Secret：`PAID_ACCESS_INTERNAL_SECRET`，不得与福利业务 HMAC 密钥复用。

发布顺序：

1. 构建 TypeScript 与 Go 镜像并运行全部测试。
2. 对 PostgreSQL 执行向前兼容迁移 `0010_paid_articles.sql`。
3. 同时启动 `app`、`paid-access` 和 `nginx`。
4. 验证 `/health` 与 `/api/reader/config`，确认读者 API 为 `no-store`。
5. 失败时回滚应用镜像并将 `PAID_ARTICLES_ENABLED=false`；迁移为扩展型，不需要立即删除新表或字段。

真实数据库集成测试需要设置仅用于测试数据库的 `TEST_DATABASE_URL`。测试会创建并清理独立账号、订单、授权和文章，不得指向生产数据库。
