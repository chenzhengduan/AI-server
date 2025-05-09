/**
 * Sentry Webhook 接收服务器
 * 用于接收Sentry的Webhook消息，并进行解析处理
 */

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');

// 创建Express应用
const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;

// 企业微信机器人Webhook地址
const WECHAT_WEBHOOK_URL = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=2abc957c-2501-4467-9220-6efc5f12228e';

// 内存日志存储
const memoryLogs = [];
const MAX_MEMORY_LOGS = 1000; // 最多保存的日志条数

// 添加消息持久化相关的常量和函数
const MESSAGE_DIR = path.join(__dirname, 'messages');
const MESSAGE_FILE = path.join(MESSAGE_DIR, `sentry-messages-${new Date().toISOString().split('T')[0]}.json`);

// 创建消息存储目录
if (!fs.existsSync(MESSAGE_DIR)) {
  fs.mkdirSync(MESSAGE_DIR, { recursive: true });
}

// 从文件加载历史消息
function loadMessagesFromFile() {
  try {
    if (fs.existsSync(MESSAGE_FILE)) {
      const data = fs.readFileSync(MESSAGE_FILE, { encoding: 'utf8' });
      const messages = JSON.parse(data);
      logToFile(`从文件加载了${messages.length}条历史消息`);
      return messages;
    }
  } catch (error) {
    logToFile(`加载历史消息失败: ${error.message}`);
  }
  return [];
}

// 将消息保存到文件
function saveMessagesToFile(messages) {
  try {
    // 确保分析结果也被保存
    const messagesWithAnalysis = messages.map(message => {
      // 创建消息的深拷贝，避免修改原对象
      const messageCopy = { ...message };
      
      // 不需要额外处理，深拷贝已经包含了分析结果
      return messageCopy;
    });
    
    fs.writeFileSync(MESSAGE_FILE, JSON.stringify(messagesWithAnalysis, null, 2), { encoding: 'utf8' });
    logToFile(`已将${messages.length}条消息保存到文件`);
  } catch (error) {
    logToFile(`保存消息到文件失败: ${error.message}`);
  }
}

// 添加单条消息到文件
function appendMessageToFile(message) {
  try {
    const messages = loadMessagesFromFile();
    
    // 检查消息是否已存在，避免重复添加
    const existingIndex = messages.findIndex(m => m.id === message.id);
    
    if (existingIndex !== -1) {
      // 更新现有消息，但保留分析结果
      const existingMessage = messages[existingIndex];
      
      // 如果新消息没有分析结果但现有消息有，则保留现有的分析结果
      if (!message.analysisResult && existingMessage.analysisResult) {
        message.analysisResult = existingMessage.analysisResult;
      }
      
      messages[existingIndex] = message;
    } else {
      // 添加新消息
      messages.push(message);
    }
    
    saveMessagesToFile(messages);
  } catch (error) {
    logToFile(`添加消息到文件失败: ${error.message}`);
  }
}

// 初始化从文件加载历史消息
const recentMessages = loadMessagesFromFile();
const MAX_RECENT_MESSAGES = 100; // 最多保存的实时消息条数

// 日志目录和文件路径
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, `sentry-webhook-${new Date().toISOString().split('T')[0]}.log`);

// 创建日志目录
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// 添加DeepSeek API配置
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions';
let DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || 'sk-0785c9e92bce4010bacbb28672987241';  // 默认为占位符，实际使用时需替换
console.log('初始化DeepSeek API密钥:', DEEPSEEK_API_KEY.substring(0, 5) + '******');

// 添加API密钥配置接口
app.post('/api/config/deepseek', (req, res) => {
  try {
    // 添加请求体调试日志
    console.log('接收到DeepSeek API配置请求');
    console.log('请求头:', JSON.stringify(req.headers, null, 2));
    console.log('请求体:', JSON.stringify(req.body, null, 2));
    
    // 安全地从请求体中获取apiKey
    const apiKey = req.body && req.body.apiKey;
    
    if (!apiKey) {
      console.log('缺少API密钥参数');
      return res.status(400).json({
        status: 'error',
        message: '缺少API密钥'
      });
    }
    
    // 更新API密钥
    DEEPSEEK_API_KEY = apiKey;
    logToFile('已更新DeepSeek API密钥');
    console.log('API密钥已更新为:', apiKey.substring(0, 5) + '******');
    
    return res.status(200).json({
      status: 'success',
      message: 'DeepSeek API密钥已更新'
    });
  } catch (error) {
    console.error('更新DeepSeek API密钥时出错:', error);
    logToFile(`更新DeepSeek API密钥时出错: ${error.message}`);
    return res.status(500).json({
      status: 'error',
      message: `更新API密钥出错: ${error.message}`
    });
  }
});

// 添加API密钥状态检查接口
app.get('/api/config/deepseek/status', (req, res) => {
  try {
    console.log('收到API状态检查请求');
    console.log('当前API密钥:', DEEPSEEK_API_KEY.substring(0, 5) + '******');
    
    // 检查密钥是否为默认值
    const isConfigured = DEEPSEEK_API_KEY !== 'YOUR_API_KEY' && DEEPSEEK_API_KEY.startsWith('sk-');
    console.log('密钥已配置状态:', isConfigured);
    
    return res.status(200).json({
      status: 'success',
      isConfigured,
      message: isConfigured ? 'DeepSeek API已配置' : 'DeepSeek API尚未配置'
    });
  } catch (error) {
    console.error('检查API配置状态时出错:', error);
    logToFile(`检查DeepSeek API配置状态时出错: ${error.message}`);
    return res.status(500).json({
      status: 'error',
      message: `检查API配置状态出错: ${error.message}`
    });
  }
});

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
// 添加urlencoded支持
app.use(bodyParser.urlencoded({ extended: true }));

// 提供静态文件服务
app.use(express.static(path.join(__dirname, 'public')));

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

// 主页路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
    let messageData = null;
    switch(eventType) {
      case 'event':
        messageData = handleErrorEvent(req.body);
        break;
      case 'issue':
        messageData = handleIssueEvent(req.body);
        break;
      default:
        logToFile(`处理未知事件类型: ${eventType}`);
        logToFile('消息内容: ' + JSON.stringify(req.body, null, 2));
        
        // 尝试处理未知类型但可能是错误事件的消息
        if (req.body && req.body.event) {
          logToFile('尝试处理未知类型的错误事件');
          messageData = handleErrorEvent(req.body);
        } else {
          // 对于真正无法识别的消息，创建一个通用格式
          messageData = {
            eventType: '未知消息',
            timestamp: new Date().toISOString(),
            level: 'info',
            rawData: req.body
          };
        }
    }
    
    // 将消息发送到所有连接的客户端
    if (messageData) {
      // 添加时间戳和唯一ID
      if (!messageData.timestamp) {
        messageData.timestamp = new Date().toISOString();
      } else if (typeof messageData.timestamp === 'number') {
        // 如果是时间戳数字（毫秒），转换为ISO字符串
        messageData.timestamp = new Date(messageData.timestamp).toISOString();
      } else if (typeof messageData.timestamp === 'string') {
        // 验证时间戳字符串是否有效
        const date = new Date(messageData.timestamp);
        if (isNaN(date.getTime()) || date.getFullYear() <= 1970) {
          // 如果解析出的日期无效或年份为1970年（可能是秒级时间戳），则使用当前时间
          messageData.timestamp = new Date().toISOString();
        }
      }
      
      if (!messageData.id) {
        messageData.id = Date.now() + Math.random().toString(36).substr(2, 9);
      }
      
      // 检查消息是否已存在，以保留分析结果
      const existingIndex = recentMessages.findIndex(m => m.id === messageData.id);
      
      if (existingIndex !== -1) {
        // 如果消息已存在，保留其分析结果
        const existingMessage = recentMessages[existingIndex];
        if (existingMessage.analysisResult) {
          messageData.analysisResult = existingMessage.analysisResult;
        }
      }
      
      // 保存到最近消息
      recentMessages.push(messageData);
      if (recentMessages.length > MAX_RECENT_MESSAGES) {
        recentMessages.shift(); // 移除最早的消息
      }
      
      // 将消息持久化到文件
      appendMessageToFile(messageData);
      
      // 发送给所有客户端
      io.emit('sentryMessage', messageData);
      logToFile('消息已推送到前端页面并保存到本地文件');
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
 * @returns {Object} 格式化后的消息数据
 */
function handleErrorEvent(data) {
  logToFile('--------- 错误事件处理 ---------');
  
  try {
    // 提取关键信息
    const event = data.event || {};
    const project = data.project || '未知项目';
    const eventId = event.event_id || '未知ID';
    
    // 正确提取错误消息 - Sentry将消息存储在logentry.formatted中
    let message = '未知错误';
    if (event.logentry && event.logentry.formatted) {
      message = event.logentry.formatted;
    } else if (data.message) {
      message = data.message;
    } else if (event.message) {
      message = event.message;
    }
    
    const level = event.level || 'error';
    const timestamp = getValidTimestamp(event.timestamp);
    
    logToFile(`项目: ${project}`);
    logToFile(`事件ID: ${eventId}`);
    logToFile(`错误消息: ${message}`);
    logToFile(`错误级别: ${level}`);
    logToFile(`发生时间: ${timestamp}`);
    
    // 如果有异常信息，提取并打印
    let exceptionType = '未知';
    let exceptionValue = '未知';
    if (event.exception && event.exception.values && event.exception.values.length > 0) {
      const exception = event.exception.values[0];
      exceptionType = exception.type || '未知';
      exceptionValue = exception.value || '未知';
      
      logToFile(`异常类型: ${exceptionType}`);
      logToFile(`异常值: ${exceptionValue}`);
      
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
    
    sendToWechatBot('错误事件', {
      project,
      eventId,
      message,  
      level,
      timestamp,
      exceptionType: exceptionInfo ? (exceptionInfo.type || '未知') : '未知',
      exceptionValue: exceptionInfo ? (exceptionInfo.value || '未知') : '未知'
    });
    
    // 返回消息数据
    return {
      eventType: '错误事件',
      project,
      eventId,
      message,
      level,
      timestamp,
      exceptionType,
      exceptionValue
    };
    
  } catch (error) {
    logToFile(`解析错误事件数据时出错: ${error.message}`);
    console.error(error);
    return {
      eventType: '错误事件解析失败',
      error: error.message,
      timestamp: new Date().toISOString(),
      level: 'error'
    };
  }
}

/**
 * 处理问题事件
 * @param {Object} data - 问题事件数据
 * @returns {Object} 格式化后的消息数据
 */
function handleIssueEvent(data) {
  logToFile('--------- 问题事件处理 ---------');
  
  try {
    // 提取关键信息
    const issue = data.issue || {};
    const action = data.action || '未知动作';
    const issueId = issue.id || '未知ID';
    
    // 正确提取标题和消息
    let title = '未知标题';
    if (issue.title) {
      title = issue.title;
    } else if (data.title) {
      title = data.title;
    } else if (data.message) {
      title = data.message;
    }
    
    // 提取来源和级别
    const culprit = issue.culprit || data.culprit || '未知来源';
    const level = issue.level || data.level || '未知级别';
    const timestamp = getValidTimestamp(issue.lastSeen || data.timestamp);
    
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
    
    // 返回消息数据
    return {
      eventType: '问题事件',
      issueId,
      action,
      title,
      culprit,
      level,
      timestamp
    };
    
  } catch (error) {
    logToFile(`解析问题事件数据时出错: ${error.message}`);
    console.error(error);
    return {
      eventType: '问题事件解析失败',
      error: error.message,
      timestamp: new Date().toISOString(),
      level: 'error'
    };
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

// Socket.io连接处理
io.on('connection', (socket) => {
  logToFile(`新客户端连接: ${socket.id}`);
  
  // 发送最近的消息历史给新连接的客户端
  if (recentMessages.length > 0) {
    socket.emit('historyMessages', recentMessages);
    logToFile(`已发送${recentMessages.length}条历史消息到客户端: ${socket.id}`);
  }
  
  // 客户端断开连接
  socket.on('disconnect', () => {
    logToFile(`客户端断开连接: ${socket.id}`);
  });
});

// 清空所有消息
app.delete('/api/messages/all', (req, res) => {
  try {
    // 清空消息数组
    recentMessages = [];
    
    // 保存空数组到文件
    saveMessagesToFile(recentMessages);
    
    logToFile('所有消息已清除');
    
    // 通知所有客户端清空消息
    io.emit('clearMessages');
    
    return res.status(200).json({ 
      status: 'success', 
      message: '所有消息已清除' 
    });
  } catch (error) {
    logToFile(`清除所有消息时出错: ${error.message}`);
    console.error('清除消息错误:', error);
    return res.status(500).json({ 
      status: 'error', 
      message: `清除消息出错: ${error.message}` 
    });
  }
});

// 批量删除消息
app.delete('/api/messages', (req, res) => {
  try {
    const { ids } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ 
        status: 'error', 
        message: '缺少有效的消息ID数组' 
      });
    }
    
    logToFile(`接收到批量删除请求，要删除 ${ids.length} 条消息`);
    
    // 记录删除前的消息数量
    const beforeCount = recentMessages.length;
    
    // 过滤掉要删除的消息
    recentMessages = recentMessages.filter(msg => !ids.includes(msg.id));
    
    // 计算实际删除的数量
    const deletedCount = beforeCount - recentMessages.length;
    
    // 保存更新后的消息数组到文件
    saveMessagesToFile(recentMessages);
    
    // 向所有客户端发送更新
    io.emit('messagesUpdated', { deletedIds: ids });
    
    logToFile(`已删除 ${deletedCount} 条消息`);
    
    return res.status(200).json({ 
      status: 'success', 
      message: `已删除 ${deletedCount} 条消息`,
      deletedCount
    });
  } catch (error) {
    logToFile(`批量删除消息时出错: ${error.message}`);
    console.error('批量删除消息错误:', error);
    return res.status(500).json({ 
      status: 'error', 
      message: `批量删除消息出错: ${error.message}` 
    });
  }
});

// 添加获取消息列表API端点
app.get('/api/messages', (req, res) => {
  try {
    const count = req.query.count ? parseInt(req.query.count) : null;
    const messages = count ? recentMessages.slice(-count) : recentMessages;
    res.status(200).json(messages);
  } catch (error) {
    logToFile(`获取消息列表时出错: ${error.message}`);
    res.status(500).json({ status: 'error', message: '获取消息列表时出错' });
  }
});

// 添加消息文件信息API端点
app.get('/api/messages/info', (req, res) => {
  try {
    let fileStats = null;
    if (fs.existsSync(MESSAGE_FILE)) {
      const stats = fs.statSync(MESSAGE_FILE);
      fileStats = {
        path: MESSAGE_FILE,
        size: Math.round(stats.size / 1024) + ' KB',
        modified: stats.mtime.toLocaleString(),
        messageCount: recentMessages.length
      };
    }
    
    res.status(200).json({
      currentFile: fileStats,
      memoryCount: recentMessages.length,
      maxCount: MAX_RECENT_MESSAGES
    });
  } catch (error) {
    logToFile(`获取消息文件信息时出错: ${error.message}`);
    res.status(500).json({ status: 'error', message: '获取消息文件信息时出错' });
  }
});

// 下载消息文件
app.get('/api/messages/download', (req, res) => {
  try {
    if (fs.existsSync(MESSAGE_FILE)) {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=sentry-messages-${new Date().toISOString().split('T')[0]}.json`);
      res.sendFile(MESSAGE_FILE);
    } else {
      res.status(404).json({ status: 'error', message: '消息文件不存在' });
    }
  } catch (error) {
    logToFile(`下载消息文件时出错: ${error.message}`);
    res.status(500).json({ status: 'error', message: '下载消息文件时出错' });
  }
});

// 添加测试消息API
app.post('/api/test-messages', async (req, res) => {
  try {
    logToFile('收到发送测试消息请求');
    
    // 加载测试脚本
    const testScript = require('./test-realtime');
    
    // 异步执行测试脚本
    testScript.runTest().then(() => {
      logToFile('测试消息已发送');
    }).catch((error) => {
      logToFile(`发送测试消息失败: ${error.message}`);
    });
    
    // 立即返回成功响应，不等待测试完成
    res.status(200).json({ status: 'success', message: '测试消息发送请求已接收' });
    
  } catch (error) {
    logToFile(`处理测试消息请求时出错: ${error.message}`);
    console.error(error);
    res.status(500).json({ status: 'error', message: '发送测试消息时出错' });
  }
});

// 设置定期保存消息到文件的任务
const AUTO_SAVE_INTERVAL = 5 * 60 * 1000; // 5分钟
setInterval(() => {
  try {
    if (recentMessages.length > 0) {
      saveMessagesToFile(recentMessages);
      logToFile(`自动保存: 已将${recentMessages.length}条消息保存到文件`);
    }
  } catch (error) {
    logToFile(`自动保存消息失败: ${error.message}`);
  }
}, AUTO_SAVE_INTERVAL);

// 添加一个辅助函数来验证和修正时间戳
/**
 * 验证并返回有效的时间戳
 * @param {string|number} timestamp - 原始时间戳
 * @returns {string} ISO格式的时间戳
 */
function getValidTimestamp(timestamp) {
  if (!timestamp) {
    return new Date().toISOString();
  }
  
  try {
    // 如果是数字（秒级时间戳），需要转换为毫秒
    if (typeof timestamp === 'number') {
      // 判断是秒级还是毫秒级时间戳
      const date = timestamp > 9999999999 
        ? new Date(timestamp) // 毫秒级
        : new Date(timestamp * 1000); // 秒级
        
      if (!isNaN(date.getTime()) && date.getFullYear() > 1970) {
        return date.toISOString();
      }
    }
    
    // 如果是字符串，尝试直接解析
    if (typeof timestamp === 'string') {
      const date = new Date(timestamp);
      if (!isNaN(date.getTime()) && date.getFullYear() > 1970) {
        return date.toISOString();
      }
    }
    
    // 默认情况下返回当前时间
    return new Date().toISOString();
  } catch (error) {
    logToFile(`解析时间戳出错: ${error.message}`);
    return new Date().toISOString();
  }
}

// 添加AI分析API接口
app.post('/api/analyze', async (req, res) => {
  try {
    logToFile('收到AI分析请求');
    console.log('收到AI分析请求');
    
    // 输出进入API的标记
    console.log('=====================================');
    console.log('开始处理AI分析请求');
    
    // 添加请求大小检查
    const requestSize = JSON.stringify(req.body).length;
    console.log(`请求大小: ${requestSize} 字节`);
    
    if (requestSize > 1024 * 1024) { // 超过1MB的请求
      logToFile(`AI分析请求过大: ${requestSize} 字节`);
      console.log(`请求过大，拒绝处理`);
      return res.status(413).json({ 
        status: 'error', 
        message: '分析请求数据过大，请选择较小的消息进行分析' 
      });
    }
    
    // 确保req.body存在
    if (!req.body) {
      console.log('请求体为空');
      return res.status(400).json({
        status: 'error',
        message: '请求体为空'
      });
    }
    
    const { messageId, messageContent } = req.body;
    console.log(`消息ID: ${messageId}`);
    
    if (!messageContent) {
      console.log('缺少必要的消息内容参数');
      return res.status(400).json({ 
        status: 'error', 
        message: '缺少必要的消息内容参数' 
      });
    }
    
    // 检查消息内容的格式和类型
    logToFile(`分析消息ID: ${messageId}`);
    logToFile(`分析消息内容类型: ${typeof messageContent}`);
    console.log(`消息内容类型: ${typeof messageContent}`);
    
    try {
      // 安全地记录消息内容摘要，避免过大或格式问题
      const contentPreview = typeof messageContent === 'object' 
        ? JSON.stringify(messageContent).substring(0, 500) + '...' 
        : String(messageContent).substring(0, 500) + '...';
      logToFile(`分析消息内容预览: ${contentPreview}`);
      console.log(`消息内容预览OK`);
    } catch (e) {
      logToFile(`记录消息内容失败: ${e.message}`);
      console.log(`记录消息内容失败: ${e.message}`);
    }
    
    // 设置响应超时
    console.log('设置响应超时处理...');
    res.setTimeout(300000, () => {
      logToFile('AI分析请求超时');
      console.log('请求处理超时');
      if (!res.headersSent) {
        return res.status(408).json({
          status: 'error',
          message: '分析请求处理超时，请稍后重试或选择较小的消息'
        });
      }
    });
    
    // 调用AI分析函数
    console.log('调用AI分析处理函数...');
    const analysisResult = await analyzeMessageWithAI(messageContent);
    console.log('AI分析完成，准备返回结果');
    
    // 如果响应头尚未发送，则返回结果
    if (!res.headersSent) {
      console.log('发送分析结果响应');
      return res.status(200).json({
        status: 'success',
        messageId,
        analysis: analysisResult
      });
    } else {
      console.log('响应头已发送，不重复发送结果');
    }
    
    console.log('=====================================');
    
  } catch (error) {
    logToFile(`AI分析请求处理出错: ${error.message}`);
    console.error('AI分析错误:', error);
    console.log(`处理出错: ${error.message}`);
    
    // 检查响应是否已发送
    if (!res.headersSent) {
      return res.status(500).json({
        status: 'error',
        message: `AI分析出错: ${error.message}`
      });
    }
  }
});

/**
 * 使用AI分析消息内容
 * @param {Object} messageContent - 消息内容
 * @returns {Object} - 分析结果
 */
async function analyzeMessageWithAI(messageContent) {
  try {
    logToFile('开始AI分析');
    
    // 处理可能的消息格式问题
    let safeMessageContent = messageContent;
    if (typeof messageContent === 'string') {
      try {
        safeMessageContent = JSON.parse(messageContent);
      } catch (e) {
        logToFile(`消息内容解析失败，将按字符串处理: ${e.message}`);
        safeMessageContent = { message: messageContent };
      }
    }
    
    // 构建适合分析的提示词
    let prompt = '';
    const isErrorEvent = safeMessageContent.eventType === '错误事件';
    const isInfoEvent = safeMessageContent.level === 'info';
    
    if (isErrorEvent) {
      prompt = `
分析以下Sentry错误事件并提供解决方案:

项目: ${safeMessageContent.project || '未知'}
错误消息: ${safeMessageContent.message || '未知错误'}
错误级别: ${safeMessageContent.level || 'error'}
异常类型: ${safeMessageContent.exceptionType || '未知'}
异常详情: ${safeMessageContent.exceptionValue || '无详情'}

请提供:
1. 错误原因分析
2. 可能的解决方案
3. 预防此类错误的建议
4. 根本原因分析（详细分析错误的根本原因、影响和可能的源头）
5. 代码修复建议（包含针对此类错误的具体代码示例和最佳实践）
`;
    } else if (isInfoEvent) {
      prompt = `
分析以下信息日志内容并提供解释:

项目: ${safeMessageContent.project || '未知'}
日志内容: ${safeMessageContent.message || '未知内容'}
日志级别: info

请提供:
1. 这条日志表示什么操作或状态
2. 这是否是正常的系统行为
3. 此日志是否需要特别关注
`;
    } else {
      // 其他类型消息
      let messagePreview = '';
      try {
        messagePreview = JSON.stringify(safeMessageContent).substring(0, 1000);
      } catch (e) {
        messagePreview = '无法序列化消息内容';
      }
      
      prompt = `
分析以下Sentry事件内容:

事件类型: ${safeMessageContent.eventType || '未知类型'}
事件内容预览: ${messagePreview}

请提供:
1. 此事件的含义解释
2. 是否需要采取行动
3. 建议的后续步骤
`;
    }
    
    // 判断是使用DeepSeek API还是本地模拟
    if (DEEPSEEK_API_KEY !== 'YOUR_API_KEY') {
      // 调用DeepSeek API
      logToFile('使用DeepSeek API进行分析');
      return await callDeepSeekAPI(prompt, safeMessageContent);
    } else {
      // 使用本地模拟
      logToFile('使用本地模拟进行分析（DeepSeek API未配置）');
      return await simulateAIAnalysis(prompt, safeMessageContent);
    }
    
  } catch (error) {
    logToFile(`AI分析处理失败: ${error.message}`);
    return {
      error: true,
      message: `分析失败: ${error.message}`,
      reason: "分析过程中发生错误",
      suggestion: "请稍后重试或联系支持团队。"
    };
  }
}

/**
 * 调用DeepSeek API进行AI分析
 * @param {string} prompt - 提示词
 * @param {Object} messageContent - 消息内容
 * @returns {Object} - 分析结果
 */
async function callDeepSeekAPI(prompt, messageContent) {
  try {
    const isErrorEvent = messageContent.eventType === '错误事件';
    
    // 构建请求体
    const requestBody = {
      model: "deepseek-chat",  // 或其他支持的模型ID
      messages: [
        {
          role: "system",
          content: "你是一个专业的错误分析和故障排查专家，擅长分析程序错误并提供解决方案。请分析以下错误信息并提供详细的分析和修复建议。输出应当包含格式化的Markdown，提供结构化的分析结果。"
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.3,  // 较低的温度以获得更确定性的回答
      max_tokens: 2000
    };
    
    // 发送请求到DeepSeek API
    logToFile('向DeepSeek API发送请求');
    const response = await axios.post(DEEPSEEK_API_URL, requestBody, {
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    
    logToFile('DeepSeek API响应成功');
    
    // 解析API响应
    const aiResponse = response.data.choices[0]?.message?.content || '';
    logToFile('AI响应内容长度: ' + aiResponse.length);
    
    // 解析AI响应到结构化结果
    return parseAIResponse(aiResponse, isErrorEvent);
    
  } catch (error) {
    logToFile(`调用DeepSeek API失败: ${error.message}`);
    if (error.response) {
      logToFile(`API错误状态: ${error.response.status}`);
      logToFile(`API错误数据: ${JSON.stringify(error.response.data)}`);
    }
    
    // 发生错误时返回错误信息
    return {
      error: true,
      reason: `DeepSeek API调用失败: ${error.message}`,
      solution: "请检查API密钥是否正确，或稍后重试。",
      prevention: "确保网络连接稳定且API密钥有效。"
    };
  }
}

/**
 * 解析AI响应到结构化结果
 * @param {string} aiResponse - AI响应文本
 * @param {boolean} isErrorEvent - 是否是错误事件
 * @returns {Object} - 结构化的分析结果
 */
function parseAIResponse(aiResponse, isErrorEvent) {
  try {
    // 为不同类型的消息准备不同的解析逻辑
    if (isErrorEvent) {
      // 错误事件解析
      const result = {
        reason: extractSection(aiResponse, "错误原因分析", "可能的解决方案") ||
                extractSection(aiResponse, "原因分析", "解决方案") ||
                "未能从AI响应中提取错误原因分析",
                
        solution: extractSection(aiResponse, "可能的解决方案", "预防此类错误的建议") ||
                 extractSection(aiResponse, "解决方案", "预防措施") ||
                 "未能从AI响应中提取解决方案",
                 
        prevention: extractSection(aiResponse, "预防此类错误的建议", "根本原因分析") ||
                   extractSection(aiResponse, "预防措施", "根本原因分析") ||
                   "未能从AI响应中提取预防建议",
                   
        rootCauseAnalysis: extractSection(aiResponse, "根本原因分析", "代码修复建议") ||
                          "未能从AI响应中提取根本原因分析",
                          
        codeFixSuggestion: extractSection(aiResponse, "代码修复建议", null) ||
                          "未能从AI响应中提取代码修复建议"
      };
      
      return result;
    } else {
      // 非错误事件（信息事件或其他）
      // 提取关键段落
      const explanation = extractSection(aiResponse, "1", "2") || 
                         extractSection(aiResponse, "含义解释", "是否") ||
                         aiResponse;
                         
      const isNormal = extractSection(aiResponse, "2", "3") ||
                      extractSection(aiResponse, "正常的系统行为", "需要特别关注");
                      
      const attention = extractSection(aiResponse, "3", null) || 
                       extractSection(aiResponse, "需要特别关注", null);
                       
      const actionNeeded = extractSection(aiResponse, "是否需要采取行动", "建议的后续步骤");
      
      const nextSteps = extractSection(aiResponse, "建议的后续步骤", null);
      
      // 构建结果对象
      const result = {
        explanation: explanation || "未能从AI响应中提取解释"
      };
      
      // 根据可用数据填充其他字段
      if (isNormal) result.isNormal = isNormal;
      if (attention) result.attention = attention;
      if (actionNeeded) result.actionNeeded = actionNeeded;
      if (nextSteps) result.nextSteps = nextSteps;
      
      return result;
    }
  } catch (error) {
    logToFile(`解析AI响应时出错: ${error.message}`);
    // 返回原始响应作为解释
    return {
      explanation: aiResponse || "AI分析结果解析失败",
      error: true
    };
  }
}

/**
 * 从文本中提取特定部分
 * @param {string} text - 完整文本
 * @param {string} startMarker - 开始标记
 * @param {string} endMarker - 结束标记
 * @returns {string} - 提取的文本段落
 */
function extractSection(text, startMarker, endMarker) {
  if (!text) return "";
  
  try {
    // 查找开始位置
    let startPos = text.indexOf(startMarker);
    if (startPos === -1) {
      // 尝试查找标题格式
      startPos = text.indexOf(`### ${startMarker}`);
      if (startPos === -1) {
        startPos = text.indexOf(`## ${startMarker}`);
        if (startPos === -1) {
          startPos = text.indexOf(`# ${startMarker}`);
          if (startPos === -1) return "";
        }
      }
    }
    
    // 移动到标记后
    startPos = text.indexOf('\n', startPos);
    if (startPos === -1) return "";
    startPos += 1;
    
    // 查找结束位置
    let endPos;
    if (endMarker) {
      endPos = text.indexOf(endMarker, startPos);
      if (endPos === -1) {
        // 尝试查找标题格式
        endPos = text.indexOf(`### ${endMarker}`, startPos);
        if (endPos === -1) {
          endPos = text.indexOf(`## ${endMarker}`, startPos);
          if (endPos === -1) {
            endPos = text.indexOf(`# ${endMarker}`, startPos);
            if (endPos === -1) endPos = text.length;
          }
        }
      }
    } else {
      endPos = text.length;
    }
    
    // 提取并返回文本段落
    return text.substring(startPos, endPos).trim();
  } catch (error) {
    logToFile(`提取文本段落时出错: ${error.message}`);
    return "";
  }
}

/**
 * 模拟AI分析 (临时函数，当DeepSeek API未配置时使用)
 * @param {string} prompt - 提示词
 * @param {Object} messageContent - 消息内容
 * @returns {Object} - 分析结果
 */
async function simulateAIAnalysis(prompt, messageContent) {
  // 模拟API调用延迟
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // 安全地获取消息属性
  const safeGetProp = (obj, prop, defaultValue) => {
    try {
      return obj && typeof obj === 'object' && prop in obj ? obj[prop] : defaultValue;
    } catch (e) {
      return defaultValue;
    }
  };
  
  const isErrorEvent = safeGetProp(messageContent, 'eventType', '') === '错误事件';
  const isInfoEvent = safeGetProp(messageContent, 'level', '') === 'info';
  
  let messagePreview = '';
  try {
    messagePreview = typeof messageContent.message === 'string' 
      ? messageContent.message.substring(0, 100) 
      : JSON.stringify(messageContent).substring(0, 100);
  } catch (e) {
    messagePreview = '无法提取消息内容';
  }
  
  if (isErrorEvent) {
    // 增强版错误分析：根本原因分析与代码修复建议
    return {
      reason: `根据错误消息"${messagePreview}"和异常类型"${safeGetProp(messageContent, 'exceptionType', '未知')}"分析，这个错误可能是由于以下原因导致：\n\n1. 无效的参数或输入数据\n2. 资源访问权限问题\n3. 代码逻辑错误导致的异常`,
      solution: `建议采取以下解决方案：\n\n1. 检查输入参数的有效性和格式\n2. 验证相关资源的访问权限\n3. 在出错位置添加异常处理逻辑\n4. 参考异常堆栈追踪错误源头`,
      prevention: `为预防此类错误，建议：\n\n1. 加强输入验证\n2. 完善异常处理机制\n3. 添加适当的日志记录\n4. 考虑实现重试机制`,
      rootCauseAnalysis: generateRootCauseAnalysis(messageContent),
      codeFixSuggestion: generateCodeFixSuggestion(messageContent)
    };
  } else if (isInfoEvent) {
    return {
      explanation: `这是一条信息级别的日志，内容为"${messagePreview}"。这通常表示系统的正常操作或状态变化的信息记录。`,
      isNormal: `是的，这是系统正常运行过程中的信息记录，不表示错误或异常状态。`,
      attention: `一般情况下，信息级别的日志不需要特别关注。除非您正在追踪特定流程或监控系统状态变化，否则可以将其视为正常的系统行为记录。`
    };
  } else {
    return {
      explanation: `这是一个${safeGetProp(messageContent, 'eventType', '未知类型')}事件。根据提供的信息，这可能是系统状态变化或用户操作的记录。`,
      actionNeeded: `基于当前信息，无法确定是否需要采取行动。建议结合上下文和系统状态进一步评估。`,
      nextSteps: `建议的后续步骤：\n\n1. 监控系统是否有相关的异常表现\n2. 检查相关功能是否正常运行\n3. 如有必要，查看更多日志以获取完整上下文`
    };
  }
}

/**
 * 根据错误信息和堆栈生成根本原因分析
 * @param {Object} messageContent - 错误事件内容
 * @returns {string} - 根本原因分析结果
 */
function generateRootCauseAnalysis(messageContent) {
  try {
    // 提取关键错误信息
    const errorMessage = messageContent.message || '未知错误';
    const exceptionType = messageContent.exceptionType || '未知类型';
    const stackTrace = messageContent.stacktrace || '';
    const frames = messageContent.frames || [];
    
    // 识别错误模式
    const isNullReference = /null|undefined|is not (defined|a function)/.test(errorMessage);
    const isTypeError = exceptionType === 'TypeError' || /TypeError/.test(errorMessage);
    const isAsyncError = /await|async|promise|then|catch/.test(errorMessage + stackTrace);
    const isNetworkError = /network|fetch|http|request|response|timeout/.test(errorMessage);
    const isPermissionError = /permission|access|denied|forbidden/.test(errorMessage);
    const isMemoryError = /memory|allocation|stack overflow|heap/.test(errorMessage);
    
    // 分析错误行为并确定可能的根本原因
    let rootCause = '';
    let impactAnalysis = '';
    
    // 根据错误类型进行专门分析
    if (isNullReference) {
      rootCause = "**空引用错误**：代码试图访问不存在或未定义的对象或属性。";
      impactAnalysis = "此类错误通常会导致操作中断，用户可能会看到空白页面或功能无响应。";
    } else if (isTypeError) {
      rootCause = "**类型错误**：代码对某个值执行了不支持的操作，或期望的类型与实际不符。";
      impactAnalysis = "类型错误会阻止特定功能的执行，通常表明代码逻辑中存在基本假设错误。";
    } else if (isAsyncError) {
      rootCause = "**异步处理错误**：在异步操作的处理过程中出现问题。";
      impactAnalysis = "异步错误可能导致数据加载失败、操作无响应或部分功能不可用。";
    } else if (isNetworkError) {
      rootCause = "**网络请求错误**：与外部资源通信时发生问题。";
      impactAnalysis = "网络错误会导致数据无法获取或提交，影响依赖该数据的所有功能。";
    } else if (isPermissionError) {
      rootCause = "**权限错误**：尝试访问无权限的资源或执行受限操作。";
      impactAnalysis = "权限错误通常表明安全配置问题或身份验证失败，可能导致功能受限。";
    } else if (isMemoryError) {
      rootCause = "**内存错误**：程序遇到内存限制或资源耗尽问题。";
      impactAnalysis = "内存错误严重时会导致应用崩溃，轻微时可能引起性能下降或页面卡顿。";
    } else {
      // 通用错误分析
      rootCause = "**逻辑错误**：代码逻辑或控制流程中存在问题。";
      impactAnalysis = "此类错误可能导致功能异常、数据不一致或用户体验问题。";
    }
    
    // 分析堆栈追踪以找出错误来源
    let sourceAnalysis = "";
    if (frames && frames.length > 0) {
      // 查找可能的错误源头文件和行号
      const errorFrames = frames.slice(0, 2); // 只取最靠近错误源头的2个堆栈帧
      sourceAnalysis = "\n\n**错误位置**：";
      
      errorFrames.forEach((frame, index) => {
        const fileName = frame.filename || '未知文件';
        const lineNumber = frame.lineno || '?';
        const functionName = frame.function || '未知函数';
        
        sourceAnalysis += `${index === 0 ? '问题出现在' : '调用自'} ${fileName} 第 ${lineNumber} 行，${functionName} 函数内。\n`;
      });
    }
    
    // 生成简洁的根本原因分析
    return `${rootCause}\n\n${impactAnalysis}${sourceAnalysis}`;
  } catch (error) {
    logToFile(`生成根本原因分析时出错: ${error.message}`);
    return "无法生成详细的根本原因分析。";
  }
}

/**
 * 生成代码修复建议
 * @param {Object} messageContent - 错误事件内容
 * @returns {string} - 代码修复建议
 */
function generateCodeFixSuggestion(messageContent) {
  try {
    // 提取关键错误信息
    const errorMessage = messageContent.message || '未知错误';
    const exceptionType = messageContent.exceptionType || '未知类型';
    
    // 根据不同错误类型生成不同的修复建议
    let fixSuggestion = '';
    
    // 空引用错误修复建议
    if (/null|undefined|is not (defined|a function)/.test(errorMessage)) {
      fixSuggestion = `
**修复建议**：
\`\`\`javascript
// 添加空值检查
const result = object && object.property ? object.property.nestedProperty : defaultValue;

// 或使用可选链操作符（ES2020）
const result = object?.property?.nestedProperty ?? defaultValue;
\`\`\``;
    } 
    // 类型错误修复建议
    else if (exceptionType === 'TypeError' || /TypeError/.test(errorMessage)) {
      fixSuggestion = `
**修复建议**：
\`\`\`javascript
// 添加类型检查
const result = typeof value === 'object' && typeof value.method === 'function' 
  ? value.method() 
  : handleAlternative();
\`\`\``;
    }
    // 异步错误修复建议 
    else if (/await|async|promise|then|catch/.test(errorMessage)) {
      fixSuggestion = `
**修复建议**：
\`\`\`javascript
// 完善异步错误处理
try {
  const response = await apiCall();
  return response.data;
} catch (error) {
  console.error('API调用失败:', error);
  return defaultValue;
}
\`\`\``;
    }
    // 其他错误的通用建议
    else {
      fixSuggestion = `
**修复建议**：
1. 检查错误发生位置的输入参数是否符合预期
2. 增加错误处理逻辑，捕获并记录异常
3. 对关键函数添加单元测试，验证各种边缘情况`;
    }
    
    return fixSuggestion;
  } catch (error) {
    logToFile(`生成代码修复建议时出错: ${error.message}`);
    return "无法生成详细的代码修复建议。";
  }
}

// 在服务器启动时添加一些日志输出
server.listen(PORT, () => {
  logToFile(`Sentry Webhook服务器已启动，监听端口: ${PORT}`);
  logToFile(`前端页面: http://localhost:${PORT}`);
  logToFile(`健康检查: http://localhost:${PORT}/health`);
  logToFile(`Webhook接收地址: http://localhost:${PORT}/webhook`);
  logToFile(`日志文件路径: ${LOG_FILE}`);
  logToFile(`消息存储路径: ${MESSAGE_FILE}`);
  logToFile(`已从文件加载 ${recentMessages.length} 条历史消息`);
  
  console.log(`Sentry Webhook服务器已启动，监听端口: ${PORT}`);
  console.log(`前端页面: http://localhost:${PORT}`);
});
