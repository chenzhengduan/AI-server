// 在加载完Vue应用后运行此脚本
document.addEventListener('DOMContentLoaded', function() {
    // 检查Vue和ElementPlus是否已加载
    if (typeof Vue === 'undefined') {
        console.error('Vue未加载！');
        document.body.innerHTML = '<div style="text-align:center;padding:50px;"><h2 style="color:red;">Vue组件库加载失败</h2><p>请检查网络连接并刷新页面</p></div>';
        return;
    }
    
    if (typeof ElementPlus === 'undefined') {
        console.error('ElementPlus未加载！');
        document.body.innerHTML = '<div style="text-align:center;padding:50px;"><h2 style="color:red;">ElementPlus组件库加载失败</h2><p>请检查网络连接并刷新页面</p></div>';
        return;
    }
    
    console.log('Vue和ElementPlus已成功加载，初始化应用...');
    
    const { createApp, ref, reactive, onMounted, onUnmounted, computed, nextTick, watch } = Vue;

    // 确保ElementPlus的组件可用
    // 首先注册ElementPlus的所有组件
    ElementPlus.install = function(app) {
        for (const [key, component] of Object.entries(ElementPlus)) {
            if (key.startsWith('El') && typeof component === 'object') {
                app.component(key, component);
            }
        }
        // 注册指令
        app.config.globalProperties.$ELEMENT = ElementPlus;
        return app;
    };

    const app = createApp({
        setup() {
            document.querySelector('#app').setAttribute('v-cloak', '');
            document.body.classList.add('vue-initialized');
            // 解决页面可见性问题
            document.documentElement.style.visibility = 'visible';
            
            const isConnected = ref(false);
            const isReconnecting = ref(false);
            const messages = ref([]);
            const searchQuery = ref('');
            const searchField = ref('all');
            const messageInfo = ref(null);
            const showInfoDialog = ref(false);
            const showClearDialog = ref(false);
            const selectedMessageTypes = ref(['all']);
            const showAnalysisConfirmDialog = ref(false);
            const currentAnalysisMessage = ref(null);
            const isMobile = ref(window.innerWidth <= 768);
            const pageSize = ref(isMobile.value ? 5 : 15); // 移动端每页显示5条，桌面端15条
            const currentPage = ref(1);
            const activeCollapse = ref(['main']); // 折叠面板状态，默认展开主要分析结果
            
            // 主题相关
            const isDarkMode = ref(localStorage.getItem('darkMode') === 'true' || false);
            
            // 批量操作相关
            const selectAll = ref(false);
            const selectedMessages = ref([]);
            const showBatchAnalysisDialog = ref(false);
            
            let socket = null;
            
            // 增加DeepSeek API配置相关状态
            const showApiConfigDialog = ref(false);
            const apiConfig = reactive({
                apiKey: ''
            });
            const apiConfigStatus = reactive({
                isConfigured: false,
                message: '尚未检查API配置状态'
            });
            const isUpdatingApiConfig = ref(false);
            
            // 监听窗口大小变化
            const checkMobileScreen = () => {
                isMobile.value = window.innerWidth <= 768;
                pageSize.value = isMobile.value ? 5 : 15;
            };
            
            onMounted(() => {
                window.addEventListener('resize', checkMobileScreen);
            });
            
            onUnmounted(() => {
                window.removeEventListener('resize', checkMobileScreen);
            });
            
            // 计算属性：过滤后的消息列表
            const filteredMessages = computed(() => {
                // 第一步：应用类型筛选
                let result = messages.value;
                
                // 如果未选择"全部"且选择了特定类型
                if (!selectedMessageTypes.value.includes('all') && selectedMessageTypes.value.length > 0) {
                    result = result.filter(message => {
                        // 信息类型：检查是否存在eventType为信息事件的消息
                        if (selectedMessageTypes.value.includes('info') && message.eventType === '信息事件') {
                            return true;
                        }
                        
                        // 错误事件类型 - 只匹配level为error的和eventType为错误事件的
                        if (selectedMessageTypes.value.includes('error')) {
                            if (message.level === 'error' || 
                                message.level === 'fatal' ||
                                (message.eventType === '错误事件' && message.level !== 'info')) {
                                return true;
                            }
                        }
                        
                        // 警告类型 - 只匹配level为warning的和eventType为问题事件的
                        if (selectedMessageTypes.value.includes('warning')) {
                            if (message.level === 'warning' || 
                                (message.eventType === '问题事件' && message.level !== 'error' && message.level !== 'info')) {
                                return true;
                            }
                        }
                        
                        // 信息类型 - 只匹配level为info的
                        if (selectedMessageTypes.value.includes('info')) {
                            if (message.level === 'info') {
                                return true;
                            }
                        }
                        
                        // 调试类型 - 只匹配level为debug的
                        if (selectedMessageTypes.value.includes('debug')) {
                            if (message.level === 'debug') {
                                return true;
                            }
                        }
                        
                        // 其他类型 - 排除已知类型的其他消息
                        if (selectedMessageTypes.value.includes('other')) {
                            if (message.level !== 'error' && 
                                message.level !== 'warning' && 
                                message.level !== 'info' && 
                                message.level !== 'debug' &&
                                message.eventType !== '错误事件' && 
                                message.eventType !== '问题事件' && 
                                message.eventType !== '信息事件') {
                                return true;
                            }
                        }
                        
                        return false;
                    });
                }
                
                // 第二步：应用搜索筛选
                if (!searchQuery.value) {
                    return result;
                }
                
                const query = searchQuery.value.toLowerCase();
                
                return result.filter(message => {
                    if (searchField.value === 'all') {
                        // 搜索所有字段
                        return JSON.stringify(message).toLowerCase().includes(query);
                    } else {
                        // 搜索特定字段
                        const fieldValue = message[searchField.value];
                        if (fieldValue) {
                            return String(fieldValue).toLowerCase().includes(query);
                        }
                        return false;
                    }
                });
            });
            
            // 分页后的消息列表
            const paginatedMessages = computed(() => {
                const start = (currentPage.value - 1) * pageSize.value;
                const end = start + pageSize.value;
                return filteredMessages.value.slice(start, end);
            });
            
            // 总页数
            const totalPages = computed(() => {
                return Math.ceil(filteredMessages.value.length / pageSize.value);
            });
            
            // 改变页码
            const handlePageChange = (page) => {
                currentPage.value = page;
                // 滚动到页面顶部
                const messageList = document.querySelector('.message-list');
                if (messageList) {
                    messageList.scrollTop = 0;
                }
            };
            
            // 搜索消息
            const searchMessages = () => {
                // 搜索已经由计算属性处理，这里可以添加额外的搜索逻辑
                console.log(`搜索: ${searchQuery.value}, 字段: ${searchField.value}`);
                currentPage.value = 1; // 重置到第一页
            };
            
            // 清除搜索
            const clearSearch = () => {
                searchQuery.value = '';
                currentPage.value = 1; // 重置到第一页
            };
            
            // 格式化时间
            const formatTime = (timestamp) => {
                try {
                    if (!timestamp) return '未知时间';
                    
                    // 确保时间戳为数值
                    let date;
                    if (typeof timestamp === 'string') {
                        date = new Date(timestamp);
                    } else if (typeof timestamp === 'number') {
                        date = new Date(timestamp);
                    } else {
                        date = timestamp;
                    }
                    
                    // 验证日期是否有效
                    if (isNaN(date.getTime())) {
                        return '无效时间';
                    }
                    
                    // 1970年表示时间戳可能有问题
                    if (date.getFullYear() <= 1970) {
                        return '无效时间';
                    }
                    
                    return date.toLocaleString('zh-CN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                    });
                } catch (e) {
                    console.error('格式化时间出错:', e);
                    return timestamp?.toString() || '未知时间';
                }
            };
            
            // 获取标签类型
            const getTagType = (message) => {
                // 错误事件始终使用 danger
                if (message.eventType === '错误事件') {
                    return 'danger';
                }
                
                // 根据消息级别设置颜色
                if (message.level) {
                    switch(message.level.toLowerCase()) {
                        case 'error':
                        case 'fatal':
                            return 'danger';
                        case 'warning':
                            return 'warning';
                        case 'info':
                            return 'success';
                        case 'debug':
                            return 'info';
                        default:
                            return 'info';
                    }
                }
                
                // 问题事件默认使用 warning
                if (message.eventType === '问题事件') {
                    return 'warning';
                }
                
                // 其他类型默认使用 info
                return 'info';
            };
            
            // 获取消息存储信息
            const fetchMessageInfo = async () => {
                try {
                    const response = await fetch('/api/messages/info');
                    if (response.ok) {
                        messageInfo.value = await response.json();
                    }
                } catch (error) {
                    console.error('获取消息信息失败:', error);
                }
            };
            
            // 获取API配置状态
            const checkApiConfigStatus = async () => {
                try {
                    console.log('正在检查API配置状态...');
                    const response = await fetch('/api/config/deepseek/status')
                        .catch(error => {
                            console.error('获取API状态请求失败:', error);
                            throw new Error(`请求失败: ${error.message}`);
                        });
                        
                    console.log('API状态响应码:', response.status);
                    
                    if (response.ok) {
                        const data = await response.json();
                        console.log('API状态响应数据:', data);
                        apiConfigStatus.isConfigured = data.isConfigured;
                        apiConfigStatus.message = data.message;
                    } else {
                        console.error('API状态请求失败，状态码:', response.status);
                        ElementPlus.ElMessage.error('获取API配置状态失败');
                    }
                } catch (error) {
                    console.error('检查API配置状态出错:', error);
                    console.error('错误详情:', error.stack);
                    ElementPlus.ElMessage.error(`获取API状态失败: ${error.message}`);
                }
            };
            
            // 保存API配置
            const saveApiConfig = async () => {
                if (!apiConfig.apiKey) {
                    ElementPlus.ElMessage.warning('请输入API密钥');
                    return;
                }
                
                isUpdatingApiConfig.value = true;
                try {
                    console.log('准备发送API配置请求...');
                    
                    // 构建请求数据
                    const requestData = {
                        apiKey: apiConfig.apiKey
                    };
                    console.log('请求数据:', JSON.stringify(requestData));
                    
                    const response = await fetch('/api/config/deepseek', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(requestData)
                    }).catch(error => {
                        console.error('API请求发送失败:', error);
                        throw new Error(`请求发送失败: ${error.message}`);
                    });
                    
                    console.log('收到响应状态:', response.status);
                    
                    if (response.ok) {
                        const data = await response.json();
                        console.log('响应数据:', data);
                        ElementPlus.ElMessage.success(data.message || 'API密钥已更新');
                        
                        // 更新配置状态
                        await checkApiConfigStatus();
                        
                        // 关闭对话框
                        showApiConfigDialog.value = false;
                    } else {
                        console.error('请求失败，状态码:', response.status);
                        // 尝试读取错误响应
                        let errorText = '';
                        try {
                            const errorData = await response.json();
                            errorText = errorData.message || '未知错误';
                            console.error('错误响应数据:', errorData);
                        } catch (e) {
                            errorText = '无法解析服务器响应';
                            console.error('无法解析错误响应:', e);
                        }
                        ElementPlus.ElMessage.error(`更新失败: ${errorText}`);
                    }
                } catch (error) {
                    console.error('更新API配置出错:', error);
                    console.error('错误详情:', error.stack);
                    ElementPlus.ElMessage.error(`保存API密钥失败: ${error.message}`);
                } finally {
                    isUpdatingApiConfig.value = false;
                }
            };
            
            // 下拉菜单命令处理
            const handleCommand = (command) => {
                switch (command) {
                    case 'download':
                        downloadMessages();
                        break;
                    case 'info':
                        fetchMessageInfo();
                        showInfoDialog.value = true;
                        break;
                    case 'refresh':
                        fetchMessages();
                        break;
                    case 'clear':
                        showClearDialog.value = true;
                        break;
                    case 'configApi':
                        showApiConfigDialog.value = true;
                        break;
                }
            };
            
            // 下载消息文件
            const downloadMessages = () => {
                window.open('/api/messages/download', '_blank');
            };
            
            // 获取消息列表
            const fetchMessages = async () => {
                try {
                    const loading = ElementPlus.ElLoading.service({
                        lock: true,
                        text: '加载消息中...',
                        background: 'rgba(0, 0, 0, 0.7)'
                    });
                    
                    const response = await fetch('/api/messages');
                    
                    if (response.ok) {
                        const data = await response.json();
                        
                        // 保存已有消息的分析结果
                        const analysisResults = {};
                        messages.value.forEach(msg => {
                            if (msg.analysisResult) {
                                analysisResults[msg.id] = msg.analysisResult;
                            }
                        });
                        
                        // 处理消息数据
                        const processedMessages = data.map(message => {
                            // 添加必要的字段
                            const processedMessage = {
                                ...message,
                                id: message.id || Date.now() + Math.random().toString(36).substr(2, 9),
                                isNew: false,
                                isAnalyzing: false
                            };
                            
                            // 从现有消息恢复分析结果
                            if (analysisResults[processedMessage.id]) {
                                processedMessage.analysisResult = analysisResults[processedMessage.id];
                            } else if (!processedMessage.analysisResult) {
                                processedMessage.analysisResult = null;
                            }
                            
                            return processedMessage;
                        });
                        
                        // 按时间倒序排序
                        processedMessages.sort((a, b) => {
                            const timeA = new Date(a.timestamp || 0).getTime();
                            const timeB = new Date(b.timestamp || 0).getTime();
                            return timeB - timeA;
                        });
                        
                        // 更新消息列表，保持平滑过渡
                        messages.value = processedMessages;
                        
                        // 重置到第一页
                        currentPage.value = 1;
                        
                        fetchMessageInfo();
                    }
                    
                    loading.close();
                } catch (error) {
                    console.error('获取消息列表失败:', error);
                    ElementPlus.ElMessage.error('获取消息列表失败');
                }
            };
            
            // 清空内存和持久化存储中的所有消息
            const confirmClearAllMessages = async () => {
                try {
                    showClearDialog.value = false;
                    
                    const response = await fetch('/api/messages/all', {
                        method: 'DELETE'
                    });
                    
                    if (response.ok) {
                        messages.value = [];
                        selectedMessages.value = [];
                        selectAll.value = false;
                        ElementPlus.ElMessage.success('所有消息已清空');
                    } else {
                        const error = await response.json();
                        ElementPlus.ElMessage.error(`清空失败: ${error.message || '服务器错误'}`);
                    }
                } catch (error) {
                    console.error('确认清空消息出错:', error);
                    ElementPlus.ElMessage.error('清空消息失败');
                }
            };
            
            // 清空本地消息 (仅内存中的)
            const clearMessages = async () => {
                try {
                    showClearDialog.value = true;
                } catch (error) {
                    console.error('清空消息出错:', error);
                    ElementPlus.ElMessage.error('清空消息失败');
                }
            };
            
            // 更新连接Socket.io
            const connectSocket = () => {
                try {
                    if (socket) {
                        socket.disconnect();
                    }
                    
                    socket = io();
                    
                    socket.on('connect', () => {
                        isConnected.value = true;
                        isReconnecting.value = false;
                        console.log('与服务器连接成功');
                    });
                    
                    socket.on('disconnect', () => {
                        isConnected.value = false;
                        console.log('与服务器断开连接');
                    });
                    
                    socket.on('newMessage', (newMessage) => {
                        // 标记为新消息
                        newMessage.isNew = true;
                        
                        // 添加到本地消息列表
                        messages.value.unshift(newMessage);
                        
                        // 3秒后移除新消息高亮
                        setTimeout(() => {
                            const index = messages.value.findIndex(msg => msg.id === newMessage.id);
                            if (index !== -1) {
                                messages.value[index].isNew = false;
                            }
                        }, 3000);
                    });
                    
                    socket.on('clearMessages', () => {
                        messages.value = [];
                        ElementPlus.ElMessage.info('服务器已清空所有消息');
                    });
                    
                    // 添加对批量删除消息的响应
                    socket.on('messagesUpdated', (data) => {
                        if (data.deletedIds && Array.isArray(data.deletedIds)) {
                            // 从本地列表中删除这些消息
                            messages.value = messages.value.filter(msg => !data.deletedIds.includes(msg.id));
                            // 更新选中的消息
                            updateSelectedMessages();
                        }
                    });
                    
                } catch (error) {
                    console.error('连接套接字时出错:', error);
                    isConnected.value = false;
                }
            };
            
            // 重新连接
            const reconnectSocket = async () => {
                isReconnecting.value = true;
                
                try {
                    if (socket) {
                        socket.disconnect();
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    connectSocket();
                    
                    fetchMessages();
                } catch (error) {
                    console.error('重新连接失败:', error);
                    ElementPlus.ElMessage.error('重新连接失败');
                    isReconnecting.value = false;
                }
            };
            
            // 高亮搜索结果中的匹配文本
            const highlightText = (text, query) => {
                if (!query || !text) return text;
                try {
                    const regex = new RegExp(`(${query})`, 'gi');
                    return text.toString().replace(regex, '<span class="highlight">$1</span>');
                } catch (e) {
                    return text;
                }
            };
            
            // 用于安全地渲染高亮HTML
            const renderHighlightedHTML = (text, query) => {
                if (!query || !text) return text;
                return highlightText(text, query);
            };
            
            // 添加相对时间计算函数
            const getRelativeTime = (timestamp) => {
                try {
                    if (!timestamp) return '未知时间';
                    
                    // 确保时间戳为数值
                    let date;
                    if (typeof timestamp === 'string') {
                        date = new Date(timestamp);
                    } else if (typeof timestamp === 'number') {
                        date = new Date(timestamp);
                    } else {
                        date = timestamp;
                    }
                    
                    // 验证日期是否有效
                    if (isNaN(date.getTime())) {
                        return '无效时间';
                    }
                    
                    // 1970年表示时间戳可能有问题
                    if (date.getFullYear() <= 1970) {
                        return '无效时间';
                    }
                    
                    const now = new Date();
                    const diff = Math.floor((now - date) / 1000); // 时间差（秒）
                    
                    if (diff < 60) {
                        return `${diff}秒前`;
                    } else if (diff < 3600) {
                        return `${Math.floor(diff / 60)}分钟前`;
                    } else if (diff < 86400) {
                        return `${Math.floor(diff / 3600)}小时前`;
                    } else if (diff < 2592000) {
                        return `${Math.floor(diff / 86400)}天前`;
                    } else if (diff < 31536000) {
                        return `${Math.floor(diff / 2592000)}个月前`;
                    } else {
                        return `${Math.floor(diff / 31536000)}年前`;
                    }
                } catch (e) {
                    console.error('格式化相对时间出错:', e);
                    return '未知时间';
                }
            };
            
            // 重置筛选类型的方法
            const resetTypeFilters = () => {
                console.log('重置筛选条件');
                selectedMessageTypes.value = ['all'];
                currentPage.value = 1; // 重置到第一页
            };
            
            // 更新applyTypeFilters方法的逻辑
            const applyTypeFilters = (values) => {
                console.log('筛选值变更:', values);
                
                // 如果选择了"all"，清除其他选择
                if (values.includes('all')) {
                    selectedMessageTypes.value = ['all'];
                } 
                // 如果清除了所有选择，默认选中"all"
                else if (values.length === 0) {
                    selectedMessageTypes.value = ['all'];
                }
                // 如果选择了特定类型，移除"all"
                else if (values.length > 0 && values.includes('all')) {
                    // 移除"all"选项
                    selectedMessageTypes.value = values.filter(v => v !== 'all');
                } else {
                    // 保留用户选择的筛选条件
                    selectedMessageTypes.value = values;
                }
                
                console.log('当前筛选条件:', selectedMessageTypes.value);
                
                // 重置到第一页
                currentPage.value = 1;
            };
            
            // 消息类型统计
            const messageTypeStats = computed(() => {
                const stats = {
                    error: 0,
                    warning: 0,
                    info: 0,
                    debug: 0,
                    other: 0
                };
                
                messages.value.forEach(message => {
                    // 检查是否存在eventType为信息事件的消息
                    if (message.eventType === '信息事件') {
                        stats.info++;
                    }
                    // 错误类型：level为error或fatal，或者eventType为错误事件（但非info级别）
                    else if (message.level === 'error' || 
                        message.level === 'fatal' || 
                        (message.eventType === '错误事件' && message.level !== 'info')) {
                        stats.error++;
                    } 
                    // 警告类型：level为warning，或者eventType为问题事件（但非error和info级别）
                    else if (message.level === 'warning' || 
                            (message.eventType === '问题事件' && message.level !== 'error' && message.level !== 'info')) {
                        stats.warning++;
                    } 
                    // 信息类型：level为info
                    else if (message.level === 'info') {
                        stats.info++;
                    } 
                    // 调试类型：level为debug
                    else if (message.level === 'debug') {
                        stats.debug++;
                    } 
                    // 其他任何不符合上述条件的消息
                    else {
                        stats.other++;
                    }
                });
                
                // 输出调试信息到控制台
                console.log('消息类型统计:', stats);
                
                return stats;
            });
            
            // 添加发送测试消息的函数
            const runTestMessages = async () => {
                try {
                    // 打开加载状态
                    const loading = ElementPlus.ElLoading.service({
                        lock: true,
                        text: '正在发送测试消息...',
                        background: 'rgba(0, 0, 0, 0.7)'
                    });
                    
                    // 发送测试消息的请求
                    const response = await fetch('/api/test-messages', {
                        method: 'POST'
                    });
                    
                    loading.close();
                    
                    if (response.ok) {
                        ElementPlus.ElMessage.success('测试消息已发送，请等待几秒钟查看结果');
                    } else {
                        const data = await response.json();
                        ElementPlus.ElMessage.error('发送失败: ' + (data.message || '未知错误'));
                    }
                } catch (error) {
                    ElementPlus.ElMessage.error('发送测试消息失败: ' + error.message);
                }
            };
            
            // AI分析消息
            const analyzeMessage = async (message) => {
                try {
                    console.log('开始分析消息:', message.id);
                    
                    // 如果消息已经有分析结果，则不重新分析
                    if (message.analysisResult) {
                        ElementPlus.ElMessage.info('该消息已经分析过，无需重新分析');
                        return;
                    }
                    
                    // 对于信息类型消息，需要先确认
                    if (message.level === 'info') {
                        console.log('信息类型消息，显示确认对话框');
                        currentAnalysisMessage.value = message;
                        showAnalysisConfirmDialog.value = true;
                        return;
                    }
                    
                    // 直接分析其他类型消息
                    console.log('直接分析非信息类型消息');
                    await performAnalysis(message);
                } catch (error) {
                    console.error('分析消息时出错:', error);
                    ElementPlus.ElMessage.error(`启动分析失败: ${error.message}`);
                }
            };
            
            // 确认分析信息类型消息
            const confirmAnalysis = async () => {
                // 关闭确认对话框
                showAnalysisConfirmDialog.value = false;
                
                if (currentAnalysisMessage.value) {
                    // 执行分析
                    await performAnalysis(currentAnalysisMessage.value);
                    currentAnalysisMessage.value = null;
                }
            };
            
            // 取消分析
            const cancelAnalysis = () => {
                showAnalysisConfirmDialog.value = false;
                currentAnalysisMessage.value = null;
            };
            
            // 执行AI分析
            const performAnalysis = async (message) => {
                console.log('执行performAnalysis函数, 消息ID:', message.id);
                try {
                    // 设置分析状态
                    message.isAnalyzing = true;
                    
                    // 定义请求超时控制
                    const timeout = 180000; // 3分钟超时
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), timeout);
                    
                    console.log('准备发送分析请求...');
                    
                    // 构造请求数据
                    const requestData = {
                        messageId: message.id,
                        messageContent: message
                    };
                    console.log('请求数据大小:', JSON.stringify(requestData).length, '字节');
                    
                    // 发送分析请求
                    const response = await fetch('/api/analyze', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(requestData),
                        signal: controller.signal
                    });
                    
                    // 清除超时控制
                    clearTimeout(timeoutId);
                    
                    console.log('收到服务器响应, 状态码:', response.status);
                    
                    if (response.ok) {
                        const data = await response.json();
                        console.log('分析完成，获得结果');
                        // 保存分析结果
                        message.analysisResult = data.analysis;
                        ElementPlus.ElMessage.success('AI分析完成');
                    } else {
                        let errorMsg = '未知错误';
                        try {
                            const error = await response.json();
                            errorMsg = error.message || '服务器返回错误';
                            console.error('服务器返回错误:', error);
                        } catch (e) {
                            console.error('解析错误响应失败:', e);
                            errorMsg = `状态码 ${response.status}`;
                        }
                        ElementPlus.ElMessage.error(`分析失败: ${errorMsg}`);
                    }
                } catch (error) {
                    console.error('AI分析请求出错:', error);
                    
                    // 针对连接重置错误给出更具体的提示
                    if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
                        ElementPlus.ElMessage.error('服务器连接中断，请检查服务器是否正常运行');
                    } else if (error.name === 'AbortError') {
                        ElementPlus.ElMessage.error('分析请求超时，服务器可能处理负载过高');
                    } else {
                        ElementPlus.ElMessage.error(`分析请求失败: ${error.message}`);
                    }
                } finally {
                    // 清除分析状态
                    message.isAnalyzing = false;
                }
            };
            
            // 清除分析结果
            const clearAnalysis = (message) => {
                message.analysisResult = null;
            };
            
            // 格式化内容，将换行符转换为HTML换行
            const formatContent = (content) => {
                if (!content) return '';
                return content.replace(/\n/g, '<br>');
            };
            
            // 获取分析结果摘要
            const getSummary = (result) => {
                if (!result) return '无分析结果';
                
                // 对于错误事件分析
                if (result.reason) {
                    // 提取第一句作为摘要
                    const firstSentence = result.reason.split('\n')[0].split('。')[0];
                    return firstSentence.length > 50 ? firstSentence.substring(0, 50) + '...' : firstSentence;
                }
                
                // 对于信息事件分析
                if (result.explanation) {
                    const firstSentence = result.explanation.split('\n')[0].split('。')[0];
                    return firstSentence.length > 50 ? firstSentence.substring(0, 50) + '...' : firstSentence;
                }
                
                // 默认摘要
                return '查看分析详情';
            };
            
            // 批量操作相关函数
            const toggleSelectAll = (val) => {
                const visibleMessages = paginatedMessages.value;
                visibleMessages.forEach(msg => {
                    msg.selected = val;
                });
                updateSelectedMessages();
            };
            
            const updateSelectedMessages = () => {
                selectedMessages.value = messages.value.filter(msg => msg.selected);
                // 检查当前页的消息是否全部选中
                const visibleMessages = paginatedMessages.value;
                selectAll.value = visibleMessages.length > 0 && 
                                 visibleMessages.every(msg => msg.selected);
            };
            
            // 实现主题切换函数
            const toggleTheme = () => {
                isDarkMode.value = !isDarkMode.value;
                localStorage.setItem('darkMode', isDarkMode.value);
                // 立即应用主题变化
                document.documentElement.classList.toggle('dark-theme', isDarkMode.value);
                document.documentElement.classList.toggle('light-theme', !isDarkMode.value);
            };
            
            // 批量删除消息
            const batchDelete = async () => {
                try {
                    if (selectedMessages.value.length === 0) return;
                    
                    const messageIds = selectedMessages.value.map(msg => msg.id);
                    
                    // 确认删除
                    await ElementPlus.ElMessageBox.confirm(
                        `确定要删除选中的 ${selectedMessages.value.length} 条消息吗？此操作不可撤销。`,
                        '批量删除确认',
                        {
                            confirmButtonText: '确定删除',
                            cancelButtonText: '取消',
                            type: 'warning'
                        }
                    );
                    
                    // 发送批量删除请求
                    const response = await fetch('/api/messages', {
                        method: 'DELETE',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ ids: messageIds })
                    });
                    
                    if (response.ok) {
                        const data = await response.json();
                        
                        // 从本地移除被删除的消息
                        messages.value = messages.value.filter(msg => !messageIds.includes(msg.id));
                        selectedMessages.value = [];
                        selectAll.value = false;
                        
                        ElementPlus.ElMessage.success(`成功删除 ${data.deletedCount || messageIds.length} 条消息`);
                    } else {
                        const error = await response.json();
                        ElementPlus.ElMessage.error(`删除失败: ${error.message || '服务器错误'}`);
                    }
                } catch (error) {
                    if (error === 'cancel') return;
                    console.error('批量删除出错:', error);
                    ElementPlus.ElMessage.error(`操作失败: ${error.message || '未知错误'}`);
                }
            };
            
            // 批量分析消息
            const batchAnalyze = async () => {
                try {
                    if (selectedMessages.value.length === 0) return;
                    
                    if (selectedMessages.value.length > 5) {
                        // 提示用户批量分析可能需要较长时间
                        await ElementPlus.ElMessageBox.confirm(
                            `您选择了 ${selectedMessages.value.length} 条消息进行分析，处理可能需要较长时间。是否继续？`,
                            '批量分析确认',
                            {
                                confirmButtonText: '继续',
                                cancelButtonText: '取消',
                                type: 'warning'
                            }
                        );
                    }
                    
                    showBatchAnalysisDialog.value = true;
                    let successCount = 0;
                    let failCount = 0;
                    
                    // 逐个分析消息，避免服务器过载
                    for (const message of selectedMessages.value) {
                        if (!message.isAnalyzing && !message.analysisResult) {
                            try {
                                await performAnalysis(message);
                                successCount++;
                            } catch (e) {
                                failCount++;
                                console.error('消息分析失败:', e);
                                // 继续处理下一条消息
                            }
                            
                            // 添加延迟，避免连续请求过快导致服务器压力过大
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }
                    }
                    
                    showBatchAnalysisDialog.value = false;
                    if (failCount > 0) {
                        ElementPlus.ElMessage.warning(`已完成 ${successCount} 条消息的分析，${failCount} 条消息分析失败`);
                    } else {
                        ElementPlus.ElMessage.success(`已完成 ${successCount} 条消息的分析`);
                    }
                    
                } catch (error) {
                    if (error === 'cancel') return;
                    console.error('批量分析出错:', error);
                    ElementPlus.ElMessage.error(`操作失败: ${error.message || '未知错误'}`);
                    showBatchAnalysisDialog.value = false;
                }
            };
            
            // 在组件挂载时，处理主题
            onMounted(() => {
                // 应用当前主题
                document.documentElement.classList.toggle('dark-theme', isDarkMode.value);
                document.documentElement.classList.toggle('light-theme', !isDarkMode.value);
                
                // 监听主题变化
                watch(isDarkMode, (newVal) => {
                    document.documentElement.classList.toggle('dark-theme', newVal);
                    document.documentElement.classList.toggle('light-theme', !newVal);
                });
                
                connectSocket();
                fetchMessages();
                fetchMessageInfo();
                checkApiConfigStatus();
                
                // 初始化消息选择状态
                messages.value.forEach(msg => {
                    msg.selected = false;
                });
            });
            
            onUnmounted(() => {
                if (socket) {
                    socket.disconnect();
                }
            });
            
            return {
                isConnected,
                isReconnecting,
                messages,
                paginatedMessages,
                totalPages,
                currentPage,
                pageSize,
                searchQuery,
                searchField,
                filteredMessages,
                messageInfo,
                showInfoDialog,
                showClearDialog,
                selectedMessageTypes,
                messageTypeStats,
                showAnalysisConfirmDialog,
                activeCollapse,
                isDarkMode,
                selectAll,
                selectedMessages,
                showBatchAnalysisDialog,
                formatTime,
                getTagType,
                reconnectSocket,
                clearMessages,
                searchMessages,
                clearSearch,
                highlightText,
                renderHighlightedHTML,
                handleCommand,
                downloadMessages,
                fetchMessageInfo,
                confirmClearAllMessages,
                getRelativeTime,
                applyTypeFilters,
                resetTypeFilters,
                runTestMessages,
                handlePageChange,
                analyzeMessage,
                confirmAnalysis,
                cancelAnalysis,
                clearAnalysis,
                formatContent,
                getSummary,
                toggleTheme,
                toggleSelectAll,
                updateSelectedMessages,
                batchDelete,
                batchAnalyze,
                // 添加DeepSeek API配置相关状态和方法
                showApiConfigDialog,
                apiConfig,
                apiConfigStatus,
                isUpdatingApiConfig,
                checkApiConfigStatus,
                saveApiConfig
            };
        }
    });

    app.use(ElementPlus);
    app.mount('#app');
}); 