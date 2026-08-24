/**
 * AI 生成历史记录模块
 * 在业务页面引入后，调用 aiHistory.save(title, prompt, content, voiceParams) 保存记录，
 * 页面右上角会出现历史图标按钮，点击弹出面板查看、复制、生成音频。
 * 数据存储在 localStorage，每个页面独立命名空间（localStorageKey）。
 */
(function () {
  'use strict';

  const STORAGE_KEY_PREFIX = 'ai_history_';
  const MAX_RECORDS = 50;

  /**
   * 获取当前页面的历史记录列表
   */
  function getRecords() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PREFIX + location.pathname);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  /**
   * 保存一条历史记录
   * @param {string} title - 记录标题（如"每日早安"）
   * @param {string} prompt - 用户输入/提示词摘要
   * @param {string} content - AI 生成的正文内容
   * @param {object} voiceParams - TTS 参数（voice, speed, pitch 等，可为空）
   */
  function save(title, prompt, content, voiceParams) {
    if (!content || !content.trim()) return;
    const records = getRecords();
    records.unshift({
      id: Date.now(),
      time: new Date().toLocaleString('zh-CN', { hour12: false }),
      title: title,
      prompt: prompt || '',
      content: content,
      voiceParams: voiceParams || {}
    });
    // 限制最多保留 MAX_RECORDS 条
    if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
    try {
      localStorage.setItem(STORAGE_KEY_PREFIX + location.pathname, JSON.stringify(records));
    } catch (e) {
      // localStorage 满时删除最旧的几条重试
      records.splice(MAX_RECORDS);
      try {
        localStorage.setItem(STORAGE_KEY_PREFIX + location.pathname, JSON.stringify(records));
      } catch (e2) { /* ignore */ }
    }
    updateBadge();
  }

  /**
   * 删除一条历史记录
   */
  function deleteRecord(id) {
    const records = getRecords().filter(r => r.id !== id);
    try {
      localStorage.setItem(STORAGE_KEY_PREFIX + location.pathname, JSON.stringify(records));
    } catch (e) { /* ignore */ }
    updateBadge();
    // 如果面板正打开且显示的是被删的记录，刷新面板
    const panel = document.getElementById('aiHistoryPanel');
    if (panel && panel.classList.contains('open')) {
      renderPanel();
    }
  }

  /**
   * 清空所有历史记录
   */
  function clearAll() {
    try {
      localStorage.removeItem(STORAGE_KEY_PREFIX + location.pathname);
    } catch (e) { /* ignore */ }
    updateBadge();
    const panel = document.getElementById('aiHistoryPanel');
    if (panel && panel.classList.contains('open')) {
      renderPanel();
    }
  }

  /**
   * 更新右上角徽章数量
   */
  function updateBadge() {
    const badge = document.getElementById('aiHistoryBadge');
    if (!badge) return;
    const count = getRecords().length;
    badge.textContent = count > 0 ? count : '';
    badge.style.display = count > 0 ? '' : 'none';
  }

  /**
   * 从内容中提取纯文本（去除 HTML 标签）
   */
  function stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || '';
  }

  /**
   * 渲染历史面板
   */
  function renderPanel() {
    const panel = document.getElementById('aiHistoryPanel');
    if (!panel) return;
    const list = document.getElementById('aiHistoryList');
    if (!list) return;
    const records = getRecords();

    if (records.length === 0) {
      list.innerHTML = '<div class="ai-history-empty">暂无生成记录</div>';
      return;
    }

    list.innerHTML = records.map(function (r) {
      const summary = stripHtml(r.content).replace(/\s+/g, ' ').slice(0, 60) + (stripHtml(r.content).length > 60 ? '…' : '');
      const safeId = 'aih-' + r.id;
      return '<div class="ai-history-item" data-id="' + r.id + '">'
        + '<div class="ai-history-item-header">'
        + '<span class="ai-history-item-title">' + escHtml(r.title) + '</span>'
        + '<span class="ai-history-item-time">' + escHtml(r.time) + '</span>'
        + '</div>'
        + '<div class="ai-history-item-preview">' + escHtml(summary) + '</div>'
        + '<div class="ai-history-item-actions">'
        + '<button class="ai-history-btn ai-history-btn-view" onclick="aiHistory.expandRecord(' + r.id + ')">查看</button>'
        + '<button class="ai-history-btn ai-history-btn-copy" onclick="aiHistory.copyRecord(' + r.id + ')">复制</button>'
        + '<button class="ai-history-btn ai-history-btn-voice"' + (r.voiceParams && r.voiceParams.hasVoice ? '' : ' disabled style="opacity:0.4"') + '>生成音频</button>'
        + '<button class="ai-history-btn ai-history-btn-del" onclick="aiHistory.deleteRecord(' + r.id + ')">删除</button>'
        + '</div>'
        + '<div class="ai-history-item-full" id="aih-full-' + r.id + '" style="display:none">'
        + '<div class="ai-history-item-content">' + r.content + '</div>'
        + '</div>'
        + '</div>';
    }).join('');
  }

  function escHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
  }

  /**
   * 展开/折叠某条记录的完整内容
   */
  window.aiHistoryExpand = function (id) {
    var el = document.getElementById('aih-full-' + id);
    if (!el) return;
    el.style.display = el.style.display === 'none' ? '' : 'none';
  };

  /**
   * 复制某条记录的内容
   */
  window.aiHistoryCopy = function (id) {
    var records = getRecords();
    var r = records.find(function (rec) { return rec.id === id; });
    if (!r) return;
    var text = stripHtml(r.content);
    navigator.clipboard.writeText(text).then(function () {
      showToast('已复制到剪贴板');
    }).catch(function () {
      showToast('复制失败');
    });
  };

  /**
   * 为某条记录生成音频
   */
  window.aiHistoryVoice = function (id) {
    var records = getRecords();
    var r = records.find(function (rec) { return rec.id === id; });
    if (!r) return;
    if (!window.generateVoiceFromContent) {
      showToast('该页面暂不支持语音生成');
      return;
    }
    // 尝试调用页面定义的 generateVoiceFromContent 钩子
    if (typeof window.generateVoiceFromContent === 'function') {
      window.generateVoiceFromContent(r.content, r.voiceParams || {});
    } else {
      //  fallback: 用默认 voice 调用
      defaultVoiceGenerate(r.content, r.voiceParams || {});
    }
  };

  function defaultVoiceGenerate(text, params) {
    var voice = (params && params.voice) || 'zh-CN-XiaomengNeural';
    var speed = (params && params.speed) || 0.9;
    var pitch = (params && params.pitch) || 0;
    var audioEl = document.getElementById('aiHistoryAudio');
    var audioSection = document.getElementById('aiHistoryAudioSection');
    if (!audioEl) return;

    audioSection.classList.add('show');
    audioEl.src = '';
    audioEl.load();

    var tryTts = function (apiUrl) {
      return fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'tts-1',
          voice: voice,
          input: text,
          speed: speed,
          pitch: pitch
        })
      }).then(function (res) {
        if (!res.ok) throw new Error('TTS 请求失败: ' + res.status);
        return res.blob();
      });
    };

    var urls = VOICE_API_URLS || [
      'https://tts.wangwangit.com/v1/audio/speech',
      'https://wnzctts.wnzc.workers.dev/v1/audio/speech'
    ];

    var audioBlobUrl = null;
    var tryNext = function (idx) {
      if (idx >= urls.length) {
        showToast('语音生成失败');
        return;
      }
      tryTts(urls[idx]).then(function (blob) {
        if (audioBlobUrl) URL.revokeObjectURL(audioBlobUrl);
        audioBlobUrl = URL.createObjectURL(blob);
        audioEl.src = audioBlobUrl;
        audioEl.play();
      }).catch(function () {
        tryNext(idx + 1);
      });
    };
    tryNext(0);
  }

  /**
   * 初始化：在页面加载后注入历史图标并渲染面板
   */
  function init() {
    // 注入 CSS
    if (!document.getElementById('aiHistoryStyles')) {
      var style = document.createElement('style');
      style.id = 'aiHistoryStyles';
      style.textContent = AI_HISTORY_CSS;
      document.head.appendChild(style);
    }

    // 注入历史记录面板
    if (!document.getElementById('aiHistoryPanel')) {
      var panelHTML = [
        '<div id="aiHistoryOverlay" class="ai-history-overlay"></div>',
        '<div id="aiHistoryPanel" class="ai-history-panel">',
        '  <div class="ai-history-panel-header">',
        '    <span class="ai-history-panel-title">AI 生成记录</span>',
        '    <div class="ai-history-panel-actions">',
        '      <button class="ai-history-clear-btn" onclick="aiHistory.clearAll()">清空</button>',
        '      <button class="ai-history-close-btn" onclick="aiHistory.closePanel()">✕</button>',
        '    </div>',
        '  </div>',
        '  <div id="aiHistoryList" class="ai-history-list"></div>',
        '  <div id="aiHistoryAudioSection" class="ai-history-audio-section">',
        '    <audio id="aiHistoryAudio" controls></audio>',
        '  </div>',
        '</div>'
      ].join('');
      document.body.insertAdjacentHTML('beforeend', panelHTML);

      // 绑定遮罩点击关闭
      document.getElementById('aiHistoryOverlay').addEventListener('click', function () {
        aiHistory.closePanel();
      });
    }

    // 注入右上角图标按钮
    if (!document.getElementById('aiHistoryIcon')) {
      var iconBtn = document.createElement('button');
      iconBtn.id = 'aiHistoryIcon';
      iconBtn.className = 'ai-history-icon-btn';
      iconBtn.title = '查看 AI 生成记录';
      iconBtn.innerHTML = '📜<span id="aiHistoryBadge" class="ai-history-badge" style="display:none"></span>';
      iconBtn.addEventListener('click', function () {
        aiHistory.togglePanel();
      });
      // 插入到 container 最前面
      var container = document.querySelector('.container, .main-card, body');
      if (container) {
        container.insertBefore(iconBtn, container.firstChild);
      } else {
        document.body.insertBefore(iconBtn, document.body.firstChild);
      }
    }

    updateBadge();
    renderPanel();
  }

  // 面板切换
  window.aiHistoryToggle = function () {
    var panel = document.getElementById('aiHistoryPanel');
    if (!panel) return;
    panel.classList.toggle('open');
    document.getElementById('aiHistoryOverlay').classList.toggle('open', panel.classList.contains('open'));
    if (panel.classList.contains('open')) renderPanel();
  };

  window.aiHistoryClose = function () {
    var panel = document.getElementById('aiHistoryPanel');
    if (!panel) return;
    panel.classList.remove('open');
    document.getElementById('aiHistoryOverlay').classList.remove('open');
  };

  // 公开 API
  window.aiHistory = {
    save: save,
    delete: deleteRecord,
    deleteRecord: deleteRecord,
    clearAll: clearAll,
    togglePanel: window.aiHistoryToggle,
    closePanel: window.aiHistoryClose,
    expandRecord: window.aiHistoryExpand,
    copyRecord: window.aiHistoryCopy,
    voiceRecord: window.aiHistoryVoice,
    getRecords: getRecords
  };

  // 页面 DOM 加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

// ============================================================
// CSS 样式
// ============================================================
var AI_HISTORY_CSS = `
/* AI 历史记录 */
.ai-history-icon-btn {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 9999;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: none;
  background: rgba(0,0,0,0.55);
  color: #fff;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 12px rgba(0,0,0,0.25);
  transition: transform 0.2s, background 0.2s;
}
.ai-history-icon-btn:hover {
  transform: scale(1.1);
  background: rgba(0,0,0,0.75);
}
.ai-history-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  background: #ff4757;
  color: #fff;
  font-size: 11px;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}
.ai-history-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.4);
  z-index: 9998;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s;
}
.ai-history-overlay.open {
  opacity: 1;
  pointer-events: auto;
}
.ai-history-panel {
  position: fixed;
  top: 0;
  right: -380px;
  width: 360px;
  max-width: 90vw;
  height: 100vh;
  background: #1a1a2e;
  z-index: 9999;
  transition: right 0.3s ease;
  display: flex;
  flex-direction: column;
  box-shadow: -4px 0 24px rgba(0,0,0,0.4);
}
.ai-history-panel.open {
  right: 0;
}
.ai-history-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
}
.ai-history-panel-title {
  font-size: 16px;
  font-weight: bold;
  color: #fff;
}
.ai-history-panel-actions {
  display: flex;
  gap: 8px;
}
.ai-history-clear-btn {
  background: rgba(255,71,87,0.2);
  color: #ff6b81;
  border: none;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.ai-history-clear-btn:hover {
  background: rgba(255,71,87,0.35);
}
.ai-history-close-btn {
  background: rgba(255,255,255,0.1);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 14px;
  cursor: pointer;
}
.ai-history-close-btn:hover {
  background: rgba(255,255,255,0.2);
}
.ai-history-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
.ai-history-item {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 10px;
  transition: background 0.2s;
}
.ai-history-item:hover {
  background: rgba(255,255,255,0.1);
}
.ai-history-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.ai-history-item-title {
  font-size: 14px;
  font-weight: bold;
  color: #f8f8ff;
}
.ai-history-item-time {
  font-size: 11px;
  color: #888;
}
.ai-history-item-preview {
  font-size: 12px;
  color: #aaa;
  line-height: 1.5;
  margin-bottom: 8px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ai-history-item-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.ai-history-btn {
  background: rgba(255,255,255,0.1);
  color: #ddd;
  border: none;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s;
}
.ai-history-btn:hover {
  background: rgba(255,255,255,0.2);
  color: #fff;
}
.ai-history-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ai-history-btn-del:hover {
  background: rgba(255,71,87,0.25);
  color: #ff6b81;
}
.ai-history-item-full {
  margin-top: 10px;
  border-top: 1px solid rgba(255,255,255,0.1);
  padding-top: 10px;
}
.ai-history-item-content {
  font-size: 13px;
  color: #ccc;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 400px;
  overflow-y: auto;
}
.ai-history-empty {
  text-align: center;
  color: #666;
  padding: 40px 20px;
  font-size: 14px;
}
.ai-history-audio-section {
  padding: 12px;
  border-top: 1px solid rgba(255,255,255,0.1);
  display: none;
}
.ai-history-audio-section.show {
  display: block;
}
.ai-history-audio-section audio {
  width: 100%;
  height: 36px;
}
`;
