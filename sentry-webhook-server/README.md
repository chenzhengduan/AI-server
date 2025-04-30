# Sentry Webhook 接收服务器

这是一个用于接收和处理 Sentry Webhook 消息的 Node.js 服务器。它可以接收 Sentry 发送的各种事件通知，解析消息内容，并进行相应处理。

## 功能特点

- 接收 Sentry Webhook 消息
- 解析消息头和消息体
- 根据事件类型进行不同处理
- 详细打印错误和问题事件信息
- 提供健康检查接口

## 安装

```bash
# 克隆仓库
git clone <仓库地址>

# 进入项目目录
cd sentry-webhook-server

# 安装依赖
npm install
```

## 使用方法

### 启动服务器

```bash
node index.js
```

服务器默认在 3000 端口启动，可以通过环境变量 `PORT` 修改端口号。

### 配置 Sentry Webhook

1. 登录 Sentry 管理界面
2. 进入项目设置 -> 集成 -> Webhooks
3. 添加新的 Webhook
4. 填写 Webhook URL: `http://你的服务器地址:3000/webhook`
5. 选择需要接收的事件类型
6. 保存配置

## API 接口

### 健康检查

```
GET /health
```

返回服务器状态信息。

### Webhook 接收

```
POST /webhook
```

接收 Sentry 发送的 Webhook 消息。

## 消息处理

服务器会根据消息的 `sentry-hook-resource` 头信息判断事件类型，并进行相应处理：

- `event`: 错误事件，包含异常信息、堆栈跟踪等
- `issue`: 问题事件，包含问题状态变更等信息

## 自定义扩展

您可以根据需要修改 `handleErrorEvent` 和 `handleIssueEvent` 函数，添加更多处理逻辑，如：

- 发送通知到企业微信、钉钉等平台
- 将事件记录到数据库
- 触发自动化处理流程

## 许可证

ISC
