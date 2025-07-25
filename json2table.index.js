const { createApp, reactive, ref, nextTick, onBeforeUnmount } = Vue;
const { ElMessage, ElMessageBox, ElLoading } = ElementPlus;

const app = createApp({
    components: {
        Document: window.ElementPlusIconsVue.Document,
        List: window.ElementPlusIconsVue.List,
        ArrowLeft: window.ElementPlusIconsVue.ArrowLeft,
        Upload: window.ElementPlusIconsVue.Upload,
        Sunrise: window.ElementPlusIconsVue.Sunrise,
        Warning: window.ElementPlusIconsVue.WarningFilled,
    },
    setup() {
        const fieldTreeRef = ref(null);
        const state = reactive({
            jsonInput: '',
            rootNode: null,
            selectedFields: [],
            tableData: [],
            loading: false,
            errorMsg: '',
            currentNode: null,
            objectData: {}, 
            isArrayView: false,
            isObjectView: false,
            treeLoading: false,
            tableLoading: false,
            lastPasteTime: 0,
            perfWarning: false,
            debugMode: true
        });
        
        // 树组件相关状态
        const treeData = ref([]);
        const defaultExpandedKeys = ref([]);
        const logs = ref([]);
        
        // 添加日志记录
        const log = (message, type = 'info') => {
            logs.value.push({
                time: new Date().toLocaleTimeString(),
                message,
                type
            });
            
            // 保持日志在100条以内
            if (logs.value.length > 100) logs.value.shift();
        };

        // 树组件配置
        const treeProps = {
            label: 'name',
            children: 'children',
            isLeaf: 'isLeaf'
        };

        // 处理文件上传
        const handleFileChange = (file) => {
            log(`上传JSON文件: ${file.name}`, 'info');
            const reader = new FileReader();
            reader.onload = e => {
                state.jsonInput = e.target.result;
                parseJSON();
            };
            reader.readAsText(file.raw);
        };
        
        // 处理粘贴事件（添加粘贴时的加载提示）
        const handlePaste = (event) => {
            event.preventDefault();
            const pasteText = (event.clipboardData || window.clipboardData).getData('text');
            const now = Date.now();
            if (now - state.lastPasteTime < 500) return;
            state.lastPasteTime = now;
            state.jsonInput = '';
            
            // 显示粘贴加载提示
            const pasteLoading = ElLoading.service({
                lock: true,
                text: '处理粘贴内容...',
                background: 'rgba(255, 255, 255, 0.9)',
                spinner: false,
                customClass: 'paste-loading'
            });
            
            nextTick(() => {
                state.jsonInput = pasteText;
                log('从剪贴板粘贴JSON内容', 'info');
                
                // 关闭粘贴加载提示
                pasteLoading.close();
                
                // 开始解析JSON
                parseJSON();
            });
        };

        // 检测数据类型
        const detectType = (value) => {
            if (Array.isArray(value)) return 'array';
            if (value === null) return 'null';
            if (typeof value === 'object') return 'object';
            return typeof value;
        };
        
        // 创建节点
        const createNode = (path, name, type, value, parentPath = '', isArrayItem = false, index = -1) => {
            const node = {
                path,
                name,
                type,
                value,
                parentPath,
                isArrayItem,
                index,
                loaded: false,
                children: [],
                keys: type === 'object' && value ? Object.keys(value) : null,
                length: type === 'array' && value ? value.length : 0,
                hasChildren: false
            };
            
            // 安全处理null值
            if (value === null) {
                node.isLeaf = true;
                node.hasChildren = false;
                return node;
            }
            
            if (type === 'array' && value && value.length > 0) {
                node.hasChildren = true;
                node.isLeaf = false;
            } else if (type === 'object' && value && Object.keys(value).length > 0) {
                node.hasChildren = true;
                node.isLeaf = false;
            } else {
                node.isLeaf = true;
                node.hasChildren = false;
            }
            
            return node;
        };

        // 节点懒加载
        const loadTreeNode = async (node, resolve) => {
            try {
                if (node.level === 0) {
                    log(`加载根节点子节点`);
                    return resolve(state.rootNode?.children || []);
                }
                
                const data = node.data;
                log(`加载节点: ${data.path}, 类型: ${data.type}, 层级: ${node.level}`);
                
                if (data.loaded) {
                    log(`节点已加载，返回缓存子节点`, 'success');
                    return resolve(data.children || []);
                }
                
                if (data.hasChildren && !data.loaded) {
                    log(`正在加载子节点...`);
                    
                    // 模拟延迟加载
                    await new Promise(resolve => setTimeout(resolve, 30));
                    
                    let children = [];
                    
                    // 处理数组类型节点
                    if (data.type === 'array' && Array.isArray(data.value)) {
                        if (data.value && data.value.length > 0) {
                            children = data.value.slice(0, 100).map((item, idx) => {
                                const childType = detectType(item);
                                const childPath = `${data.path}[${idx}]`;
                                const childName = `[${idx}]`;
                                return createNode(childPath, childName, childType, item, data.path, true, idx);
                            });
                            
                            // 添加"查看更多"节点
                            if (data.value.length > 100) {
                                children.push({
                                    path: `${data.path}.more`,
                                    name: `[查看更多...共${data.value.length}项]`,
                                    type: 'more',
                                    parentPath: data.path,
                                    isLeaf: true,
                                    totalItems: data.value.length
                                });
                            }
                        } else {
                            // 空数组处理
                            node.hasChildren = false;
                            node.isLeaf = true;
                        }
                    } 
                    // 处理对象类型节点
                    else if (data.type === 'object' && data.value) {
                        if (data.value && typeof data.value === 'object') {
                            const entries = Object.entries(data.value);
                            if (entries.length > 0) {
                                children = entries.slice(0, 100).map(([key, val]) => {
                                    const childType = detectType(val);
                                    const childPath = `${data.path}.${key}`;
                                    return createNode(childPath, key, childType, val, data.path);
                                });
                                
                                // 添加"查看更多"节点
                                if (entries.length > 100) {
                                    children.push({
                                        path: `${data.path}.more`,
                                        name: `{查看更多...共${entries.length}键}`,
                                        type: 'more',
                                        parentPath: data.path,
                                        isLeaf: true,
                                        totalItems: entries.length
                                    });
                                }
                            } else {
                                // 空对象处理
                                node.hasChildren = false;
                                node.isLeaf = true;
                            }
                        } else {
                            // 值为 null 的对象处理
                            node.hasChildren = false;
                            node.isLeaf = true;
                        }
                    } else {
                        // 非对象/数组处理
                        node.hasChildren = false;
                        node.isLeaf = true;
                    }
                    
                    // 更新节点状态
                    data.children = children;
                    data.loaded = true;
                    
                    log(`成功加载 ${children.length} 个子节点`, 'success');
                    resolve(children);
                } else {
                    log(`节点没有子节点可加载`);
                    resolve([]);
                }
            } catch (error) {
                log(`节点加载失败: ${error.message}`, 'error');
                resolve([]);
            } finally {
                node.loading = false;
            }
        };
        
        // 处理节点点击
        const handleNodeClick = (data, node) => {
            log(`点击节点: ${data.path}, 类型: ${data.type}`);
            
            // 自动展开/折叠点击的节点
            if (node.expanded) {
                node.collapse();
            } else {
                node.expand();
            }
            
            state.currentNode = data;
            
            if (data.type === 'array' && Array.isArray(data.value)) {
                state.tableData = data.value;
                log(`更新表格数据: ${data.value.length} 条记录`);
            }
        };
        
        // 处理节点展开
        const handleNodeExpand = (data, node) => {
            log(`展开节点: ${data.path}`);
            defaultExpandedKeys.value.push(data.path);
        };
        
        // 处理节点折叠
        const handleNodeCollapse = (data, node) => {
            log(`折叠节点: ${data.path}`);
            const index = defaultExpandedKeys.value.indexOf(data.path);
            if (index > -1) {
                defaultExpandedKeys.value.splice(index, 1);
            }
        };
        
        // 主线程解析JSON
        const parseInMainThread = () => {
            try {
                if (!state.jsonInput.trim()) {
                    throw new Error('JSON内容不能为空');
                }

                let rawData;
                try {
                    rawData = JSON.parse(state.jsonInput);
                } catch (e) {
                    const jsonStart = state.jsonInput.indexOf('{');
                    const jsonEnd = state.jsonInput.lastIndexOf('}') + 1;
                    
                    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                        const jsonStr = state.jsonInput.substring(jsonStart, jsonEnd);
                        rawData = JSON.parse(jsonStr);
                    } else {
                        throw new Error('无法找到有效的JSON内容');
                    }
                }
                
                const dataType = detectType(rawData);
                log(`主线程解析成功，类型: ${dataType}`);
                
                // 创建根节点
                const rootNode = createNode('root', '根节点', dataType, rawData);
                
                // 为根节点添加子节点
                if (dataType === 'array' && Array.isArray(rawData)) {
                    rootNode.children = rawData.slice(0, 100).map((item, idx) => {
                        const childType = detectType(item);
                        const childPath = `root[${idx}]`;
                        const childName = `[${idx}]`;
                        return createNode(childPath, childName, childType, item, 'root', true, idx);
                    });
                    
                    if (rawData.length > 100) {
                        rootNode.children.push({
                            path: 'root.more',
                            name: `[查看更多...共${rawData.length}项]`,
                            type: 'more',
                            parentPath: 'root',
                            isLeaf: true,
                            totalItems: rawData.length
                        });
                    }
                } else if (dataType === 'object' && rawData) {
                    const entries = Object.entries(rawData);
                    rootNode.children = entries.slice(0, 100).map(([key, val]) => {
                        const childType = detectType(val);
                        const childPath = `root.${key}`;
                        return createNode(childPath, key, childType, val, 'root');
                    });
                    
                    if (entries.length > 100) {
                        rootNode.children.push({
                            path: 'root.more',
                            name: `{查看更多...共${entries.length}键}`,
                            type: 'more',
                            parentPath: 'root',
                            isLeaf: true,
                            totalItems: entries.length
                        });
                    }
                }
                
                return rootNode;
            } catch (e) {
                throw new Error('解析失败: ' + e.message);
            }
        };
        
        // 使用Worker处理JSON解析
        const startWorkerProcessing = (jsonInput) => {
            return new Promise((resolve, reject) => {
                if (!window.jsonParserWorker) {
                    reject('浏览器不支持Web Worker，将使用主线程处理');
                    return;
                }
                
                const worker = window.jsonParserWorker;
                
                worker.onmessage = (e) => {
                    if (e.data.type === 'error') {
                        reject(e.data.message);
                    } else {
                        resolve(e.data.rootNode);
                    }
                };
                
                worker.onerror = (error) => {
                    reject('Worker处理错误: ' + error.message);
                };
                
                worker.postMessage(jsonInput);
            });
        };
        
        // 解析JSON主入口
        const parseJSON = async () => {
            log('开始解析JSON...');
            
            // 显示简洁的文字加载提示
            const loading = ElLoading.service({
                lock: true,
                text: '解析中...',
                background: 'rgba(255, 255, 255, 0.9)',
                spinner: false,
                customClass: 'simple-loading'
            });
            
            // 强制重绘确保loading显示
            await new Promise(resolve => {
                requestAnimationFrame(() => {
                    requestAnimationFrame(resolve);
                });
            });
            
            try {
                // 设置加载状态
                state.treeLoading = true;
                state.errorMsg = '';
                logs.value = [];
                
                // 重置所有状态
                state.rootNode = null;
                state.currentNode = null;
                state.perfWarning = false;
                defaultExpandedKeys.value = ['root'];
                
                if (!state.jsonInput.trim()) {
                    throw new Error('JSON内容不能为空');
                }
                
                // 检查是否是大数据集
                const useWorker = state.jsonInput.length > 50000;
                let rootNode;
                
                // 显示性能警告
                if (useWorker) {
                    log('检测到大尺寸JSON数据，使用Worker处理');
                    state.perfWarning = true;
                }
                
                if (useWorker && window.jsonParserWorker) {
                    try {
                        rootNode = await startWorkerProcessing(state.jsonInput);
                        log('Worker处理完成');
                    } catch (e) {
                        log('Worker处理失败，使用主线程: ' + e.message, 'warning');
                        rootNode = parseInMainThread();
                    }
                } else {
                    log('使用主线程处理');
                    rootNode = parseInMainThread();
                }
                
                // 更新状态
                state.rootNode = rootNode;
                treeData.value = [state.rootNode];
                
                log('JSON解析完成，根节点加载成功');
                
                // 默认展开根节点
                defaultExpandedKeys.value = ['root'];
                
                // 默认选中根节点
                state.currentNode = state.rootNode;
                log('默认选中根节点');
                
                // 如果根节点是数组，更新表格数据
                if (state.rootNode.type === 'array' && Array.isArray(state.rootNode.value)) {
                    state.tableData = state.rootNode.value;
                    log(`更新表格数据: ${state.rootNode.value.length} 条记录`);
                }
                
                // 如果根节点是对象，更新对象数据
                if (state.rootNode.type === 'object' && state.rootNode.value) {
                    state.objectData = state.rootNode.value;
                    state.isObjectView = true;
                    log(`更新对象数据: ${Object.keys(state.rootNode.value).length} 个属性`);
                }
            } catch (e) {
                log('解析失败: ' + e.message, 'error');
                state.errorMsg = e.message;
            } finally {
                state.treeLoading = false;
                state.perfWarning = false;
                loading.close();
            }
        };
        
        // 格式化值显示
        const formatValue = (value) => {
            if (value === null) return 'null';
            if (value === undefined) return 'undefined';
            return value;
        };

        const formatComplexValue = (value) => {
            if (Array.isArray(value)) return `[数组 (${value.length}项)]`;
            if (typeof value === 'object') return `{对象 (${Object.keys(value).length}键)}`;
            return value;
        };

        const formatTooltip = (value) => {
            return JSON.stringify(value, null, 2);
        };

        const isObject = (value) => {
            return typeof value === 'object' && value !== null;
        };

        const getNestedValue = (obj, path) => {
            return path.split('.').reduce((o, p) => o?.[p], obj);
        };

        const generateTableData = (data) => {
            return data.map(item => {
                const row = {};
                state.selectedFields.forEach(field => {
                    const value = _.get(item, field);
                    row[field] = value === undefined ? '--' : value;
                });
                return row;
            });
        };

        const formatHeader = (path) => {
            return path
                .replace(/\./g, ' › ')
                .replace(/(\$\$\$\$)/g, '')
                .replace(/_/g, ' ');
        };

        const isComplexValue = (value) => {
            return typeof value === 'object' && value !== null;
        };

        const formatSimpleValue = (value) => {
            if (value === null) return 'null';
            if (value === undefined) return 'undefined';
            return value;
        };
        
        // 复制整列数据
        const copyColumnData = (fieldPath) => {
            try {
                state.errorMsg = '';
                
                // 确定要复制的数据源
                let dataSource = [];
                
                if (!state.currentNode) {
                    // 主视图中的表格数据
                    dataSource = state.tableData;
                } else if (state.currentNode.type === 'array' && Array.isArray(state.currentNode.value)) {
                    // 节点详情视图中的表格数据
                    dataSource = state.currentNode.value;
                } else {
                    throw new Error('没有可复制的数据');
                }
                
                const columnValues = dataSource.map(row => {
                    const value = row[fieldPath];
                    
                    if (value === undefined) return 'N/A';
                    
                    if (isComplexValue(value)) {
                        return formatComplexValue(value);
                    }
                    
                    return formatSimpleValue(value);
                });
                
                const textToCopy = columnValues.join('\n');
                
                navigator.clipboard.writeText(textToCopy).then(() => {
                    // 使用Element Plus的Message组件显示成功提示
                    ElMessage({
                        message: `已复制 ${formatHeader(fieldPath)} 列内容`,
                        type: 'success',
                        duration: 3000,
                        showClose: true,
                        offset: 80
                    });
                }).catch(err => {
                    state.errorMsg = `复制失败: ${err.message}`;
                });
                
            } catch (error) {
                state.errorMsg = `复制失败: ${error.message}`;
            }
        };
        
        // 辅助方法：检查是否基础类型
        const isBasicType = (type) => {
            return ['string', 'number', 'boolean', 'null'].includes(type);
        };
        
        // 格式化为预览值
        const formatPreviewValue = (value) => {
            if (value === null) return 'null';
            if (typeof value === 'string') {
                return value.length > 20 ? value.substring(0, 17) + '...' : value;
            }
            return value;
        };
        
        // 获取类型标签
        const getTypeLabel = (type) => {
            const labels = {
                object: '对象',
                array: '列表',
                string: '文本',
                number: '数字',
                boolean: '布尔',
                null: '空值'
            };
            return labels[type] || type;
        };
        
        // 获取标签类型
        const getTagType = (type) => {
            const types = {
                object: 'primary',
                array: 'warning',
                string: '',
                number: 'success',
                boolean: 'danger',
                null: 'info'
            };
            return types[type] || '';
        };
        
        // 格式化对象值显示
        const formatObjectValue = (value) => {
            if (value === null) return 'null';
            if (Array.isArray(value)) return `[数组 (${value.length}项)]`;
            if (typeof value === 'object') return `{对象 (${Object.keys(value).length}键)}`;
            return value;
        };
        
        // 获取值类型
        const getValueType = (value) => {
            if (Array.isArray(value)) return 'array';
            if (value === null) return 'null';
            if (typeof value === 'object') return 'object';
            return typeof value;
        };
        
        // 检查是否为简单数组
        const isSimpleArray = (arr) => {
            return arr.length > 0 && 
                   arr.every(item => 
                       !(item instanceof Object) || 
                       item === null
                   );
        };
        
        // 获取数组元素的键
        const getFirstArrayItemKeys = (arr) => {
            if (arr.length === 0) return [];
            
            const firstItem = arr[0];
            if (firstItem && typeof firstItem === 'object' && !Array.isArray(firstItem)) {
                return Object.keys(firstItem);
            }
            
            return [];
        };

        // 清理Web Worker
        onBeforeUnmount(() => {
            if (window.jsonParserWorker) {
                window.jsonParserWorker.terminate();
            }
        });

        // 切换节点展开状态
        const toggleNodeExpand = (node) => {
            if (node.expanded) {
                node.collapse();
            } else {
                node.expand();
            }
        };

        // 处理节点选择（不展开/折叠）
        const handleNodeSelect = (data, node) => {
            log(`选择节点: ${data.path}, 类型: ${data.type}`);
            
            state.currentNode = data;
            
            if (data.type === 'array' && Array.isArray(data.value)) {
                state.tableData = data.value;
                log(`更新表格数据: ${data.value.length} 条记录`);
            }
        };

        return {
            state,
            treeProps,
            treeData,
            fieldTreeRef,
            logs,
            defaultExpandedKeys,
            log,
            handleFileChange,
            parseJSON,
            handlePaste,
            loadTreeNode,
            handleNodeClick,
            handleNodeExpand,
            handleNodeCollapse,
            isBasicType,
            formatPreviewValue,
            getTypeLabel,
            getTagType,
            formatObjectValue,
            getValueType,
            isSimpleArray,
            getFirstArrayItemKeys,
            formatValue,
            formatComplexValue,
            formatTooltip,
            isObject,
            generateTableData,
            formatHeader,
            isComplexValue,
            formatSimpleValue,
            copyColumnData,
            toggleNodeExpand,
            handleNodeSelect
        };
    }
});

app.config.globalProperties._ = _; 
app.use(ElementPlus)
    .mount('#app');