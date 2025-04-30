/**
 * Sentry Webhook 接收服务器
 * 用于接收Sentry的Webhook消息，并进行解析处理
 */

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// 创建Express应用
const app = express();
const PORT = process.env.PORT || 3000;

// 企业微信机器人Webhook地址
const WECHAT_WEBHOOK_URL = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=2abc957c-2501-4467-9220-6efc5f12228e';

// 内存日志存储
const memoryLogs = [];
const MAX_MEMORY_LOGS = 1000; // 最多保存的日志条数

// 日志目录和文件路径
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, `sentry-webhook-${new Date().toISOString().split('T')[0]}.log`);

// 创建日志目录
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * 将日志写入文件和内存
 * @param {string} message - 日志消息
 */
function logToFile(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  
  // 输出到控制台
  console.log(message);
  
  // 存储到内存
  memoryLogs.push(logMessage);
  if (memoryLogs.length > MAX_MEMORY_LOGS) {
    memoryLogs.shift(); // 移除最早的日志
  }
  
  // 将日志追加到文件
  try {
    fs.appendFileSync(LOG_FILE, logMessage + '\n', { encoding: 'utf8' });
  } catch (error) {
    console.error(`写入日志文件失败: ${error.message}`);
  }
}

// 使用中间件解析JSON请求体
app.use(bodyParser.json());

// 健康检查路由
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Sentry Webhook服务正常运行' });
});

// 日志查看路由
app.get('/logs', (req, res) => {
  const count = req.query.count ? parseInt(req.query.count) : 100;
  const logs = memoryLogs.slice(-count).join('\n');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(logs);
});

// 日志文件下载路由
app.get('/logs/download', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename=sentry-webhook-${new Date().toISOString().split('T')[0]}.log`);
  res.sendFile(LOG_FILE);
});

// Sentry Webhook接收路由
app.post('/webhook', (req, res) => {
  try {
    logToFile('收到Sentry Webhook消息:');
    logToFile('--------- 消息头信息 ---------');
    logToFile('Headers: ' + JSON.stringify(req.headers, null, 2));
    
    logToFile('--------- 消息体信息 ---------');
    logToFile('Body: ' + JSON.stringify(req.body, null, 2));
    
    // 解析事件类型
    let eventType = req.headers['sentry-hook-resource'] || '未知事件类型';
    
    // 如果没有事件类型头信息，尝试从消息体中识别
    if (eventType === '未知事件类型' && req.body) {
      // 检查是否是Sentry错误事件
      if (req.body.event && req.body.event.event_id && req.body.event.level) {
        eventType = 'event';
        logToFile('从消息体识别出错误事件');
      } 
      // 检查是否是Sentry问题事件
      else if (req.body.issue && req.body.issue.id) {
        eventType = 'issue';
        logToFile('从消息体识别出问题事件');
      }
    }
    
    logToFile(`事件类型: ${eventType}`);
    
    // 根据事件类型进行不同处理
    switch(eventType) {
      case 'event':
        handleErrorEvent(req.body);
        break;
      case 'issue':
        handleIssueEvent(req.body);
        break;
      default:
        logToFile(`处理未知事件类型: ${eventType}`);
        logToFile('消息内容: ' + JSON.stringify(req.body, null, 2));
        
        // 尝试处理未知类型但可能是错误事件的消息
        if (req.body && req.body.event) {
          logToFile('尝试处理未知类型的错误事件');
          handleErrorEvent(req.body);
        }
    }
    
    // 返回成功响应
    res.status(200).json({ status: 'success', message: '消息已接收并处理' });
  } catch (error) {
    logToFile(`处理Webhook消息时出错: ${error.message}`);
    console.error(error);
    res.status(500).json({ status: 'error', message: '处理消息时发生错误' });
  }
});

/**
 * 处理错误事件
 * @param {Object} data - 错误事件数据
 */
function handleErrorEvent(data) {
  logToFile('--------- 错误事件处理 ---------');
  
  try {
    // 提取关键信息
    const event = data.event || {};
    const project = data.project || '未知项目';
    const eventId = event.event_id || '未知ID';
    const message = event.message || '未知错误';
    const level = event.level || '未知级别';
    const timestamp = event.timestamp || '未知时间';
    
    logToFile(`项目: ${project}`);
    logToFile(`事件ID: ${eventId}`);
    logToFile(`错误消息: ${message}`);
    logToFile(`错误级别: ${level}`);
    logToFile(`发生时间: ${timestamp}`);
    
    // 如果有异常信息，提取并打印
    if (event.exception && event.exception.values && event.exception.values.length > 0) {
      const exception = event.exception.values[0];
      logToFile(`异常类型: ${exception.type || '未知'}`);
      logToFile(`异常值: ${exception.value || '未知'}`);
      
      // 打印堆栈信息
      if (exception.stacktrace && exception.stacktrace.frames) {
        logToFile('堆栈信息:');
        exception.stacktrace.frames.forEach((frame, index) => {
          logToFile(`  [${index}] ${frame.filename || '未知文件'}:${frame.lineno || '?'} - ${frame.function || '未知函数'}`);
        });
      }
    }
    
    // 发送通知到企业微信
    const exceptionInfo = event.exception && event.exception.values && event.exception.values.length > 0 
      ? event.exception.values[0] : null;
    
    const messageContent = {
      project,
      eventId,
      message,
      level,
      timestamp,
      exceptionType: exceptionInfo ? exceptionInfo.type : '未知',
      exceptionValue: exceptionInfo ? exceptionInfo.value : '未知'
    };
    
    sendToWechatBot('错误事件', messageContent);
    
  } catch (error) {
    logToFile(`解析错误事件数据时出错: ${error.message}`);
    console.error(error);
  }
}

/**
 * 处理问题事件
 * @param {Object} data - 问题事件数据
 */
function handleIssueEvent(data) {
  logToFile('--------- 问题事件处理 ---------');
  
  try {
    // 提取关键信息
    const issue = data.issue || {};
    const action = data.action || '未知动作';
    const issueId = issue.id || '未知ID';
    const title = issue.title || '未知标题';
    const culprit = issue.culprit || '未知来源';
    const level = issue.level || '未知级别';
    
    logToFile(`问题ID: ${issueId}`);
    logToFile(`动作: ${action}`);
    logToFile(`标题: ${title}`);
    logToFile(`来源: ${culprit}`);
    logToFile(`级别: ${level}`);
    
    // 发送通知到企业微信
    const messageContent = {
      issueId,
      action,
      title,
      culprit,
      level
    };
    
    sendToWechatBot('问题事件', messageContent);
    
  } catch (error) {
    logToFile(`解析问题事件数据时出错: ${error.message}`);
    console.error(error);
  }
}

/**
 * 发送消息到企业微信机器人
 * @param {string} eventType - 事件类型
 * @param {Object} content - 消息内容
 */
async function sendToWechatBot(eventType, content) {
  try {
    // 构建markdown格式消息
    let markdownContent = `### Sentry ${eventType}通知\n`;
    
    // 根据消息内容类型构建不同的消息格式
    if (eventType === '错误事件') {
      markdownContent += `> **项目**: ${content.project}\n`;
      markdownContent += `> **事件ID**: ${content.eventId}\n`;
      markdownContent += `> **错误消息**: ${content.message}\n`;
      markdownContent += `> **错误级别**: <font color=\"${getLevelColor(content.level)}\">${content.level}</font>\n`;
      markdownContent += `> **发生时间**: ${content.timestamp}\n`;
      markdownContent += `> **异常类型**: ${content.exceptionType}\n`;
      markdownContent += `> **异常值**: ${content.exceptionValue}\n`;
    } else if (eventType === '问题事件') {
      markdownContent += `> **问题ID**: ${content.issueId}\n`;
      markdownContent += `> **动作**: ${content.action}\n`;
      markdownContent += `> **标题**: ${content.title}\n`;
      markdownContent += `> **来源**: ${content.culprit}\n`;
      markdownContent += `> **级别**: <font color=\"${getLevelColor(content.level)}\">${content.level}</font>\n`;
    } else {
      // 默认格式
      Object.entries(content).forEach(([key, value]) => {
        markdownContent += `> **${key}**: ${value}\n`;
      });
    }
    
    // 添加时间戳
    const now = new Date();
    markdownContent += `\n> 通知时间: ${now.toLocaleString()}\n`;
    
    // 构建请求体
    const requestBody = {
      msgtype: 'markdown',
      markdown: {
        content: markdownContent
      }
    };
    
    // 发送请求到企业微信
    const response = await axios.post(WECHAT_WEBHOOK_URL, requestBody);
    logToFile(`企业微信通知发送成功: ${JSON.stringify(response.data)}`);
  } catch (error) {
    logToFile(`发送企业微信通知失败: ${error.message}`);
    console.error(error);
  }
}

/**
 * 根据错误级别获取对应的颜色
 * @param {string} level - 错误级别
 * @returns {string} - 颜色代码
 */
function getLevelColor(level) {
  switch(level.toLowerCase()) {
    case 'error':
    case 'fatal':
      return 'warning';
    case 'warning':
      return 'warning';
    case 'info':
      return 'info';
    default:
      return 'info';
  }
}

// 启动服务器
app.listen(PORT, () => {
  logToFile(`Sentry Webhook服务已启动，监听端口: ${PORT}`);
  logToFile(`健康检查: http://localhost:${PORT}/health`);
  logToFile(`Webhook接收地址: http://localhost:${PORT}/webhook`);
  logToFile(`日志文件路径: ${LOG_FILE}`);
  
  console.log(`Sentry Webhook服务已启动，监听端口: ${PORT}`);
  console.log(`健康检查: http://localhost:${PORT}/health`);
  console.log(`Webhook接收地址: http://localhost:${PORT}/webhook`);
  console.log(`日志文件路径: ${LOG_FILE}`);
});
