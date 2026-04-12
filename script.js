let pluginConfig = {
    keyMode: "Standard (K1,K2,M1,M2)",
    keyNames: "W,A,S,D",
    useAverageColor: true,
    customThemeColor: "#4caf50",
    bgOpacity: 0.65,
    chartMaxY: 15
};

let activeKeys = []; 
let clickTimestamps = {};
let lastCounts = {};
let displayedKps = {};

let isPlaying = false;
let currentTotalKps = 0;
let maxKpsThisSecond = 0; 
let displayedTotalKps = -1;
let currentBgUrl = ""; // 用于记录当前背景图路径，避免重复计算

const MAX_DATA_POINTS = 300; 
const ctx = document.getElementById('kpsChart').getContext('2d');

const chart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: Array(MAX_DATA_POINTS).fill(''),
        datasets: [{
            label: 'Total KPS',
            data: Array(MAX_DATA_POINTS).fill(0),
            borderColor: 'rgb(76, 175, 80)', 
            borderWidth: 2,
            backgroundColor: 'rgba(76, 175, 80, 0.25)',
            fill: true,
            pointRadius: 0,
            tension: 0.3
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false, 
        plugins: { legend: { display: false } },
        scales: {
            y: {
                beginAtZero: true,
                max: 15, 
                ticks: { color: '#aaa', font: { size: 10 } },
                grid: { color: 'rgba(255,255,255,0.1)' }
            },
            x: { display: false }
        }
    }
});

// 提取图片平均色逻辑
function extractAverageColor(url, callback) {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = function() {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        // 降低分辨率提取以优化性能
        canvas.width = 50; 
        canvas.height = 50;
        context.drawImage(img, 0, 0, canvas.width, canvas.height);
        
        try {
            const imgData = context.getImageData(0, 0, canvas.width, canvas.height).data;
            let r = 0, g = 0, b = 0, count = 0;
            
            // 步长为4 (R, G, B, A)
            for (let i = 0; i < imgData.length; i += 4) {
                // 简单过滤掉过于偏黑或偏白的像素，避免主题色发灰
                if ((imgData[i] < 30 && imgData[i+1] < 30 && imgData[i+2] < 30) || 
                    (imgData[i] > 230 && imgData[i+1] > 230 && imgData[i+2] > 230)) {
                    continue;
                }
                r += imgData[i];
                g += imgData[i+1];
                b += imgData[i+2];
                count++;
            }
            
            if (count > 0) {
                r = Math.floor(r / count);
                g = Math.floor(g / count);
                b = Math.floor(b / count);
                callback(`rgb(${r}, ${g}, ${b})`);
            } else {
                callback('rgb(76, 175, 80)'); // 回退默认颜色
            }
        } catch(e) {
            console.warn("[KPS Plugin] 背景色提取失败 (可能是跨域或无数据):", e);
        }
    };
    img.src = url;
}

// 统一更新 UI 和图表颜色
function updateThemeColor(colorStr) {
    let r = 76, g = 175, b = 80;

    // 解析 Hex (#4caf50) 或 rgb(76, 175, 80)
    if (colorStr.startsWith('#')) {
        let hex = colorStr.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
        r = parseInt(hex.substring(0, 2), 16);
        g = parseInt(hex.substring(2, 4), 16);
        b = parseInt(hex.substring(4, 6), 16);
    } else if (colorStr.startsWith('rgb')) {
        const match = colorStr.match(/(\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
            r = parseInt(match[1]);
            g = parseInt(match[2]);
            b = parseInt(match[3]);
        }
    }

    const rgbVal = `rgb(${r}, ${g}, ${b})`;
    const rgbaBg = `rgba(${r}, ${g}, ${b}, 0.25)`;
    const rgbaGlow = `rgba(${r}, ${g}, ${b}, 0.5)`;

    // 更新 CSS 变量
    document.documentElement.style.setProperty('--theme-color', rgbVal);
    document.documentElement.style.setProperty('--theme-color-glow', rgbaGlow);

    // 更新 Chart.js
    chart.data.datasets[0].borderColor = rgbVal;
    chart.data.datasets[0].backgroundColor = rgbaBg;
    chart.update();
}

// 应用配置到 UI 和逻辑
function applyPluginSettings() {
    // 1. 更新图表 Y 轴最大值
    chart.options.scales.y.max = pluginConfig.chartMaxY;
    
    // 2. 更新背景透明度
    document.documentElement.style.setProperty('--glass-bg', `rgba(0, 0, 0, ${pluginConfig.bgOpacity})`);

    // 3. 处理颜色：如果关闭了动态取色，则恢复为自定义纯色
    if (!pluginConfig.useAverageColor) {
        updateThemeColor(pluginConfig.customThemeColor);
        currentBgUrl = ""; // 重置记录，以便下次开启时重新提取
    }

    // 4. 解析按键模式，决定监听哪些键
    if (pluginConfig.keyMode.includes("Standard")) {
        if (pluginConfig.keyMode.includes("K1,K2,M1,M2")) activeKeys = ['k1', 'k2', 'm1', 'm2'];
        else if (pluginConfig.keyMode.includes("K1,K2")) activeKeys = ['k1', 'k2'];
        else if (pluginConfig.keyMode.includes("M1,M2")) activeKeys = ['m1', 'm2'];
        else activeKeys = ['k1', 'k2', 'm1', 'm2'];
    } else if (pluginConfig.keyMode.includes("Mania")) {
        const match = pluginConfig.keyMode.match(/(\d)K/);
        const count = match ? parseInt(match[1]) : 4;
        activeKeys = [];
        for(let i = 1; i <= count; i++) {
            activeKeys.push(`k${i}`); 
        }
    }
    
    // 5. 动态生成按键 UI DOM
    const container = document.getElementById('key-container');
    container.innerHTML = ''; // 清空原有按键
    const customNames = pluginConfig.keyNames.split(',').map(s => s.trim());

    activeKeys.forEach((key, index) => {
        if (!clickTimestamps[key]) clickTimestamps[key] = [];
        if (!lastCounts[key]) lastCounts[key] = 0;
        displayedKps[key] = -1; 

        const displayName = customNames[index] || key.toUpperCase();
        const keyBox = document.createElement('div');
        keyBox.className = 'key-box'; 
        keyBox.innerHTML = `
            <div class="key-name">${displayName}</div>
            <div class="key-value" id="val-${key}">0</div>
        `;
        container.appendChild(keyBox);
    });

    console.log("[KPS Plugin] 配置已应用:", pluginConfig);
}

// 建立设置同步通道
function connectSettings() {
    let rawPath = window.COUNTER_PATH || new URLSearchParams(window.location.search).get('l');
    
    if (!rawPath) {
        const pathSegments = window.location.pathname.split('/').filter(p => p);
        if (pathSegments.length > 0) {
            rawPath = pathSegments[0];
        } else {
            rawPath = 'kps-xingjian';
        }
    }

    const counterPath = encodeURI(rawPath);
    const settingsSocket = new WebSocket(`ws://127.0.0.1:24050/websocket/commands?l=${counterPath}`);

    settingsSocket.onopen = () => {
        settingsSocket.send(`getSettings:${counterPath}`);
    };

    settingsSocket.onmessage = (msg) => {
        try {
            const data = JSON.parse(msg.data);
            if (data.command === 'getSettings' && data.message) {
                const settings = data.message;
                
                if (settings.keyMode) pluginConfig.keyMode = settings.keyMode;
                if (settings.keyNames) pluginConfig.keyNames = settings.keyNames;
                if (settings.chartMaxY) pluginConfig.chartMaxY = settings.chartMaxY;
                if (settings.customThemeColor) pluginConfig.customThemeColor = settings.customThemeColor;
                if (settings.bgOpacity !== undefined) pluginConfig.bgOpacity = settings.bgOpacity;
                if (settings.useAverageColor !== undefined) pluginConfig.useAverageColor = settings.useAverageColor;

                // 立即应用新设置
                applyPluginSettings();
            }
        } catch (err) {}
    };

    settingsSocket.onclose = () => setTimeout(connectSettings, 2000);
}

applyPluginSettings();
connectSettings();

// 实时 UI 更新循环
function updateRealtimeUI() {
    const now = Date.now();
    let total = 0;

    activeKeys.forEach(key => {
        const queue = clickTimestamps[key] || [];
        // 清理 1 秒前的点击数据
        while (queue.length > 0 && queue[0] < now - 1000) {
            queue.shift();
        }
        
        const kps = queue.length;
        if (kps !== displayedKps[key]) {
            const el = document.getElementById(`val-${key}`);
            if (el) el.innerText = kps;
            displayedKps[key] = kps;
        }
        total += kps;
    });

    currentTotalKps = total;
    if (currentTotalKps > maxKpsThisSecond) maxKpsThisSecond = currentTotalKps;

    // 更新总计 KPS
    if (total !== displayedTotalKps) {
        const totalEl = document.getElementById('val-total');
        if (totalEl) totalEl.innerText = total;
        displayedTotalKps = total;
    }

    requestAnimationFrame(updateRealtimeUI);
}

requestAnimationFrame(updateRealtimeUI);

// 游戏数据连接
function connectData() {
    const socket = new WebSocket('ws://127.0.0.1:24050/ws');
    socket.onmessage = (msg) => {
        try {
            const data = JSON.parse(msg.data);
            const state = data.state ? data.state.number : (data.menu ? data.menu.state : 0);
            isPlaying = (state === 2);
            
            // --- 动态背景取色逻辑 ---
            if (pluginConfig.useAverageColor && data.menu && data.menu.bm && data.menu.bm.path) {
                const folder = data.menu.bm.path.folder;
                const bg = data.menu.bm.path.bg;
                if (folder && bg) {
                    // 转义特殊字符保证 URL 有效性
                    const escapePath = (str) => str.replace(/%/g, '%25').replace(/#/g, '%23').replace(/\+/g, '%2B').replace(/\?/g, '%3F');
                    const bgUrl = `http://127.0.0.1:24050/Songs/${escapePath(folder)}/${escapePath(bg)}`;
                    
                    // 背景发生变化时重新提取颜色
                    if (bgUrl !== currentBgUrl) {
                        currentBgUrl = bgUrl;
                        extractAverageColor(bgUrl, (rgbColor) => {
                            if (pluginConfig.useAverageColor) { // 再次确认配置是否仍然开启
                                updateThemeColor(rgbColor);
                            }
                        });
                    }
                }
            }
            
            // --- 统计按键逻辑 ---
            const keys = data.gameplay.keyOverlay;
            if (keys) {
                activeKeys.forEach(key => {
                    if (keys[key]) {
                        const currentCount = keys[key].count;
                        if (currentCount > lastCounts[key]) {
                            const diff = currentCount - lastCounts[key];
                            for (let i = 0; i < diff; i++) {
                                clickTimestamps[key].push(Date.now());
                            }
                        }
                        lastCounts[key] = currentCount;
                    }
                });
            }
        } catch (err) {}
    };
    socket.onclose = () => setTimeout(connectData, 2000);
}

connectData();

// 图表与峰值统计更新循环 (每秒执行一次)
setInterval(() => {
    if (!isPlaying) {
        activeKeys.forEach(key => clickTimestamps[key] = []);
        maxKpsThisSecond = 0; 
    }

    // 更新图表数据
    const dataArray = chart.data.datasets[0].data;
    dataArray.push(maxKpsThisSecond);
    if (dataArray.length > MAX_DATA_POINTS) dataArray.shift();
    chart.update();

    // 更新 5 分钟 (300秒) 内的最高 KPS
    const peak = Math.max(...dataArray);
    document.getElementById('val-peak').innerText = peak;

    // 重置下一秒的峰值探测
    maxKpsThisSecond = 0; 
}, 1000);
