# 站长福利上线配置

本清单用于 P4-2 配置阶段。福利活动在数据库中保持关闭，正式开放属于 P4-3。

## 两端共享凭据

以下两对变量的值必须完全相同，但分别保存在两个 GitHub 仓库的 Secrets 中：

| FreedomPost | Opus8-CF | 约束 |
| --- | --- | --- |
| `OPUS8_INTEGRATION_KEY_ID` | `FREEDOMPOST_INTEGRATION_KEY_ID` | 3–64 位字母、数字、点、下划线或短横线 |
| `OPUS8_INTEGRATION_SECRET` | `FREEDOMPOST_INTEGRATION_SECRET` | 独立随机值，至少 32 位 |

不要把这些值写进 `.env.example`、workflow、日志或文档。

## FreedomPost GitHub Secrets

在既有部署 Secrets 之外，新增：

- `TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `OPUS8_INTEGRATION_BASE_URL`，只允许类似 `https://api.example.com` 的 HTTPS origin
- `OPUS8_INTEGRATION_KEY_ID`
- `OPUS8_INTEGRATION_SECRET`
- `BENEFIT_CLAIM_HMAC_SECRET`
- `BENEFIT_LINK_ENCRYPTION_KEY`，必须是 32 字节随机值的 canonical base64url 编码

`TURNSTILE_EXPECTED_HOSTNAME` 由工作流直接使用 `PREVIEW_DOMAIN`，其余非敏感运行参数由工作流固定。部署会同时进行 GitHub runner 预检和容器内运行时预检；任一关键变量缺失或格式错误都会在更新服务前失败。

可在可信本地终端分别生成两个独立随机值：

```text
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

同一条命令执行两次，一次用于 `BENEFIT_CLAIM_HMAC_SECRET`，一次用于 `BENEFIT_LINK_ENCRYPTION_KEY`，不得复用。

## Opus8-CF GitHub Secrets

新增：

- `FREEDOMPOST_INTEGRATION_KEY_ID`
- `FREEDOMPOST_INTEGRATION_SECRET`

控制面部署脚本会在构建和部署前执行失败关闭预检，并通过 `wrangler secret put` 写入 Worker Secret；日志只显示变量名，不显示值。

## 上线顺序

1. 在两个仓库配置共享凭据和各自 Secrets。
2. 先运行 Opus8-CF `deploy-control`，确认控制面健康检查通过。
3. 再运行 FreedomPost `Deploy`，确认容器运行时预检、`/health` 和福利 API 的 `Cache-Control: no-store` 检查通过。
4. 在 P4-3 staging 验证签名调用、Turnstile、幂等领取、故障恢复和二维码展示。
5. 所有验证完成后才启用数据库中的 `webmaster-benefit-v1` 活动。

若任一端轮换共享凭据，必须在维护窗口内同步更新另一端；两端不一致时领取接口会返回认证失败，既有用户和订阅不受影响。
