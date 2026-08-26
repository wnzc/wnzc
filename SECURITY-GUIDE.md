# 🛡️ API Key 安全保护方案

## 问题
你的项目 `ai-models.js` 和 `src/ai-config.js` 中硬编码了 API Key，已经泄露到 GitHub 历史中。

## 解决方案

### ✅ 已完成
1. 移除所有硬编码的 API Key
2. 创建代理服务器（Python FastAPI）
3. 配置 Render.com 部署

---

## 🔴 第一步：立即吊销已泄露的密钥

**必须立即执行！** 旧密钥已经泄露，无法从 git 历史中完全删除。

| 服务 | 操作 |
|------|------|
| 智谱 GLM | https://open.bigmodel.cn/usercenter/apikeys → 禁用旧 key，生成新 key |
| DeepSeek | https://platform.deepseek.com/api_keys → 禁用旧 key，生成新 key |
| Agnes | https://api.agnes-ai.cn → 禁用旧 key，生成新 key |
| uuhb.cn | 登录账号 → 生成新 apiKey |
| 彩票 token | 联系服务商获取新 token |

---

## 🚀 第二步：部署代理服务器

### 方案 A：Render.com（推荐，免费）

1. **注册账号**
   - 访问 https://render.com
   - 用 GitHub 账号登录

2. **创建 Web Service**
   - 点击 "New +" → "Web Service"
   - 连接你的 GitHub 仓库
   - 配置参数：
     ```
     Name: wnzc-proxy
     Root Directory: .
     Build Command: cd server && pip install -r requirements.txt
     Start Command: cd server && python -m uvicorn app:app --host 0.0.0.0 --port $PORT
     ```

3. **配置环境变量**
   在 Render 控制台的 "Environment" 标签页添加：
   ```
   AI_API_URL=https://api.agnes-ai.cn/v1/chat/completions
   AI_API_KEY=你的新 agnes key
   AI_MODEL=agnes-2.5-flash
   
   UUHB_API_KEY=你的新 uuhb key
   LOTTERY_TOKEN=你的新 lottery token（可选）
   ```

4. **部署**
   - 点击 "Create Web Service"
   - 等待部署完成（约 1-2 分钟）
   - 获取你的域名：`https://wnzc-proxy-xxxx.onrender.com`

### 方案 B：Railway.app（备选）

1. 访问 https://railway.app
2. 导入 GitHub 仓库
3. 添加环境变量（同上）
4. 部署

### 方案 C：国内云服务器（最稳定）

如果使用阿里云/腾讯云轻量服务器：
```bash
# 安装依赖
pip install fastapi uvicorn httpx

# 启动服务
cd server
python -m uvicorn app:app --host 0.0.0.0 --port 8000
```

---

## 📝 第三步：更新前端配置

部署完成后，修改配置文件中的代理地址：

### 1. 编辑 `ai-models.js`
```javascript
const AI_MODELS = {
  ACTIVE_MODEL: 'agnes',
  
  glm: {
    apiUrl: 'https://你的域名/chat',  // 替换为你的 Render 域名
    model: 'glm-4.7-flash'
  },
  
  deepseek: {
    apiUrl: 'https://你的域名/chat',
    model: 'deepseek-v4-flash'
  },
  
  agnes: {
    apiUrl: 'https://你的域名/chat',
    model: 'agnes-2.5-flash'
  }
};
```

### 2. 编辑 `src/ai-config.js`
```javascript
thirdParty: {
    uuhbApiUrl: 'https://你的域名/uuhb',  // 替换
    lotteryApiUrl: 'https://你的域名/lottery'  // 替换
}
```

---

## 🔒 第四步：清理 Git 历史（可选但推荐）

由于密钥已经在 git 历史中，建议重写历史：

```bash
# 安装 git-filter-repo
pip install git-filter-repo

# 创建替换文件（每一行是一个要替换的密钥）
cat > replace-text.txt << 'EOF'
sk-JK8qyN2hWca6YEa6Owvisx4FuCely1zdo3sVFj9BOIC4159H
sk-a68d43f3858a41e7ad8baa152cf6a983
8cb5d6c44a984a22a143ead8ac510d2f.9adwosowpPiml1Nq
ak_4e467bef570aafa08c488b57bd3c54946e25f2b0ff2064a1
6ad41ac5eed70a63382ff767103705b7
EOF

# 执行替换（会重写所有历史）
git filter-repo --replace-text replace-text.txt

# 强制推送到 GitHub
git push --force origin master
```

**注意**：这会重写所有历史，如果你有 collaborator，需要通知他们重新克隆。

---

## 📊 第五步：验证部署

1. **测试代理服务器**
   ```bash
   curl https://你的域名/
   # 应该返回 {"status": "ok", "service": "wnzc-api-proxy"}
   ```

2. **测试 AI 对话**
   ```bash
   curl -X POST https://你的域名/chat \
     -H "Content-Type: application/json" \
     -d '{"messages":[{"role":"user","content":"你好"}]}'
   ```

3. **访问网站**
   - 打开 https://wnzc.github.io/wnzc/
   - 测试所有 AI 功能是否正常

---

## ⚠️ 重要提醒

1. **永远不要在前端代码中硬编码 API Key**
2. **定期轮换密钥**（建议每 3-6 个月）
3. **限制密钥权限**（只开通必要的功能）
4. **监控用量**（防止被盗刷）
5. **使用 HTTPS**（代理服务器必须启用 HTTPS）

---

## 🆘 遇到问题？

- **Render 冷启动慢**：首次访问可能需要 30-60 秒，可以添加 uptime monitor 保持活跃
- **国内访问慢**：可以考虑使用国内云服务器
- **CORS 错误**：确保代理服务器返回正确的 CORS 头
- **API 调用失败**：检查环境变量是否正确配置
