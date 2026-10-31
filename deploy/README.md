# Avatar 部署（服务器 8.130.211.168）

## 安装
```bash
mkdir -p /opt/avatar && cd /opt/avatar
npm i @deepseek-ai/dsh@0.2.1-rc.5
# 复制 packages/avatar/* 到 /opt/avatar/packages/avatar/
# 创建 profile：/root/.dsh/profiles/avatar/{package.json,cordis.yml,cordis.patch.yml}
cd /root/.dsh/profiles/avatar && pnpm install
```

## 服务
```bash
cp deploy/avatar.service /etc/systemd/system/
cp deploy/avatar.env.example /etc/avatar.env && chmod 600 /etc/avatar.env
# 填 DEEPSEEK_API_KEY
systemctl daemon-reload && systemctl enable --now avatar
```

## 数据
```bash
AVATAR_ROOT=/opt/avatar/data   # templates/ skills/ outputs/
```

## 验证
```bash
curl -s http://127.0.0.1:50999/api/avatar/health
curl -s http://127.0.0.1:50999/api/avatar/templates | head -c 200
```

## 访问
- 目前只监听 127.0.0.1:50999（安全）；
- 对外暴露需在 nginx 增加 location + 鉴权（basic auth / token），未配置。
