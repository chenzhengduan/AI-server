const axios = require('axios');

// 模拟Sentry错误事件消息
const errorEventPayload = {
  event: {
    event_id: 'test-event-id-123',
    message: '测试错误消息',
    level: 'error',
    timestamp: new Date().toISOString(),
    exception: {
      values: [
        {
          type: 'Error',
          value: '测试异常',
          stacktrace: {
            frames: [
              {
                filename: 'test.js',
                lineno: 42,
                function: 'testFunction'
              }
            ]
          }
        }
      ]
    }
  },
  project: '测试项目'
};

// 模拟Sentry问题事件消息
const issueEventPayload = {
  action: 'created',
  issue: {
    id: 'test-issue-id-456',
    title: '测试问题标题',
    culprit: '测试来源',
    level: 'warning'
  }
};

// 发送错误事件消息
async function sendErrorEvent() {
  try {
    console.log('发送错误事件消息...');
    const response = await axios.post('http://localhost:3000/webhook', errorEventPayload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    console.log('错误事件发送成功:', response.status, response.statusText);
  } catch (error) {
    console.error('发送错误事件失败:', error.message);
  }
}

// 发送问题事件消息
async function sendIssueEvent() {
  try {
    console.log('发送问题事件消息...');
    const response = await axios.post('http://localhost:3000/webhook', issueEventPayload, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    console.log('问题事件发送成功:', response.status, response.statusText);
  } catch (error) {
    console.error('发送问题事件失败:', error.message);
  }
}

// 执行测试
async function runTests() {
  await sendErrorEvent();
  console.log('等待3秒...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  await sendIssueEvent();
}

runTests();
