/**
 * Sentry Webhook 测试工具
 * 用于发送测试消息到Webhook服务器，验证实时消息显示功能
 */

const axios = require('axios');

// Webhook服务器地址
const WEBHOOK_URL = 'http://localhost:3000/webhook';

// 测试错误事件数据
const errorEventData = {
  project: '测试项目',
  event: {
    event_id: 'test-event-' + Date.now(),
    level: 'error',
    timestamp: new Date().toISOString(),
    logentry: {
      formatted: '测试错误消息: 这是一个模拟的错误'
    },
    exception: {
      values: [
        {
          type: 'RuntimeError',
          value: '测试异常: 这是一个模拟的异常',
          stacktrace: {
            frames: [
              {
                filename: 'test.js',
                lineno: 42,
                function: 'testFunction'
              },
              {
                filename: 'app.js',
                lineno: 123,
                function: 'processData'
              }
            ]
          }
        }
      ]
    }
  }
};

// 测试问题事件数据
const issueEventData = {
  action: 'created',
  issue: {
    id: 'test-issue-' + Date.now(),
    title: '测试问题: 这是一个模拟的问题',
    culprit: 'test.js in testFunction',
    level: 'warning',
    lastSeen: new Date().toISOString()
  }
};

// 添加其他日志级别测试数据
const infoEventData = {
  project: '测试项目-Info',
  event: {
    event_id: 'test-info-' + Date.now(),
    level: 'info',
    timestamp: new Date().toISOString(),
    logentry: {
      formatted: '测试信息消息: 这是一个模拟的信息'
    }
  }
};

// 发送错误事件
async function sendErrorEvent() {
  try {
    console.log('发送测试错误事件...');
    const response = await axios.post(WEBHOOK_URL, errorEventData, {
      headers: {
        'Content-Type': 'application/json',
        'sentry-hook-resource': 'event'
      }
    });
    console.log('错误事件发送成功:', response.data);
    return response.data;
  } catch (error) {
    console.error('发送错误事件失败:', error.message);
    if (error.response) {
      console.error('响应状态:', error.response.status);
      console.error('响应数据:', error.response.data);
    } else if (error.request) {
      console.error('请求已发送但未收到响应');
    }
    return null;
  }
}

// 发送问题事件
async function sendIssueEvent() {
  try {
    console.log('发送测试问题事件...');
    const response = await axios.post(WEBHOOK_URL, issueEventData, {
      headers: {
        'Content-Type': 'application/json',
        'sentry-hook-resource': 'issue'
      }
    });
    console.log('问题事件发送成功:', response.data);
    return response.data;
  } catch (error) {
    console.error('发送问题事件失败:', error.message);
    if (error.response) {
      console.error('响应状态:', error.response.status);
      console.error('响应数据:', error.response.data);
    } else if (error.request) {
      console.error('请求已发送但未收到响应');
    }
    return null;
  }
}

// 添加发送info级别事件函数
async function sendInfoEvent() {
  try {
    console.log('发送测试信息事件...');
    const response = await axios.post(WEBHOOK_URL, infoEventData, {
      headers: {
        'Content-Type': 'application/json',
        'sentry-hook-resource': 'event'
      }
    });
    console.log('信息事件发送成功:', response.data);
    return response.data;
  } catch (error) {
    console.error('发送信息事件失败:', error.message);
    if (error.response) {
      console.error('响应状态:', error.response.status);
      console.error('响应数据:', error.response.data);
    } else if (error.request) {
      console.error('请求已发送但未收到响应');
    }
    return null;
  }
}

// 执行测试
async function runTest() {
  console.log('开始测试 Sentry Webhook 实时消息显示功能...');
  
  // 首先发送一个错误事件
  await sendErrorEvent();
  
  // 2秒后发送一个问题事件
  setTimeout(async () => {
    await sendIssueEvent();
    
    // 再等1秒发送info级别事件
    setTimeout(async () => {
      await sendInfoEvent();
      console.log('测试完成，请检查前端页面是否显示了所有测试消息');
    }, 1000);
  }, 2000);
}

// 修改测试脚本结尾，导出函数
// 运行测试
if (require.main === module) {
  // 直接运行脚本时执行测试
  runTest();
}

// 导出函数供其他模块使用
module.exports = {
  runTest,
  sendErrorEvent,
  sendIssueEvent,
  sendInfoEvent
}; 