// ==UserScript==
// @name          从linux do获取论坛文章数据与复制
// @namespace     http://tampermonkey.net/
// @version       0.5
// @description   从linux do论坛页面获取文章的板块、标题、链接、标签和内容总结，并在标题旁添加复制按钮。支持设置界面配置。
// @author        @Loveyless https://github.com/Loveyless/linuxdo-share
// @match         *://*.linux.do/*
// @updateURL     https://raw.githubusercontent.com/Loveyless/linuxdo-share/main/script.user.js
// @downloadURL   https://raw.githubusercontent.com/Loveyless/linuxdo-share/main/script.user.js
// @grant         GM_getValue
// @grant         GM_setValue
// @grant         GM_xmlhttpRequest
// @grant         GM_addStyle
// @grant         GM_registerMenuCommand
// @run-at        document-idle // 更可靠的运行时间，等待DOM和资源加载完成且浏览器空闲
// ==/UserScript==

(function () {
  'use strict';

  // ==========================================================
  // 配置项和默认值
  // ==========================================================
  const DEFAULT_CONFIG = {
    // 是否启用 Gemini API 进行内容总结
    USE_GEMINI_API_FOR_SUMMARY: false,
    // Gemini API Key，如果 USE_GEMINI_API_FOR_SUMMARY 为 true，则需要填写此项 获取:https://aistudio.google.com/apikey
    GEMINI_API_KEY: '',
    // Gemini 模型名称
    GEMINI_MODEL: 'gemini-2.5-flash-lite',
    // 本地内容总结的最大字符数
    LOCAL_SUMMARY_MAX_CHARS: 140,
    // 自定义总结 Prompt
    CUSTOM_SUMMARY_PROMPT: '你是一个信息获取专家，可以精准的总结文章的精华内容和重点，请对以下文章内容进行归纳总结，你应该以“作者在帖子中表达了”、“作者在帖子中表示”、“作者在该帖子中认为”等类似的文字作为总结的开头。\n\n {content}',
    // 文章复制模板
    ARTICLE_COPY_TEMPLATE: [
      `-{{title}}`,
      `@{{username}}({{category}})`, // 增加作者信息
      ``,
      `{{summary}}`,
      ``,
      `{{link}}`,
    ].join('\n')
  };

  // 获取配置值的函数
  function getConfig(key) {
    return GM_getValue(key, DEFAULT_CONFIG[key]);
  }

  // 设置配置值的函数
  function setConfig(key, value) {
    GM_setValue(key, value);
  }

  // 动态配置对象
  const CONFIG = new Proxy({}, {
    get(target, prop) {
      return getConfig(prop);
    },
    set(target, prop, value) {
      setConfig(prop, value);
      return true;
    }
  });

  // ==========================================================
  // CSS 样式定义
  // ==========================================================
  const copyBtnStyle = /*css*/`
        .copy-button { /* 统一命名为 .copy-button */
            --button-bg: #e5e6eb;
            --button-hover-bg: #d7dbe2;
            --button-text-color: #4e5969;
            --button-hover-text-color: #164de5;
            --button-border-radius: 6px;
            --button-diameter: 24px;
            --button-outline-width: 2px;
            --button-outline-color: #9f9f9f;
            --tooltip-bg: #1d2129;
            --toolptip-border-radius: 4px;
            --tooltip-font-family: JetBrains Mono, Consolas, Menlo, Roboto Mono, monospace;
            --tooltip-font-size: 12px;
            --tootip-text-color: #fff;
            --tooltip-padding-x: 7px;
            --tooltip-padding-y: 7px;
            --tooltip-offset: 8px;
        }

        html[style*="color-scheme: dark"] .copy-button {
            --button-bg: #353434;
            --button-hover-bg: #464646;
            --button-text-color: #ccc;
            --button-outline-color: #999;
            --button-hover-text-color: #8bb9fe;
            --tooltip-bg: #f4f3f3;
            --tootip-text-color: #111;
        }

        .copy-button {
            box-sizing: border-box;
            width: var(--button-diameter);
            height: var(--button-diameter);
            border-radius: var(--button-border-radius);
            background-color: var(--button-bg);
            color: var(--button-text-color);
            border: none;
            cursor: pointer;
            position: relative;
            outline: var(--button-outline-width) solid transparent;
            transition: all 0.2s ease;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            margin-left: 8px;
        }

        /* 调整标题的父元素 (h1[data-topic-id]) 为 flex 布局，确保按钮能紧随标题且对齐 */
        h1[data-topic-id] {
            display: flex !important; /* 强制 flexbox */
            align-items: center !important; /* 垂直居中对齐 */
            gap: 8px; /* 增加标题和按钮之间的间距 */
        }

        h1[data-topic-id] .fancy-title {
            margin-right: 0 !important; /* 覆盖可能存在的右外边距 */
        }

        .tooltip {
            position: absolute;
            opacity: 0;
            left: calc(100% + var(--tooltip-offset));
            top: 50%;
            transform: translateY(-50%);
            white-space: nowrap;
            font: var(--tooltip-font-size) var(--tooltip-font-family);
            color: var(--tootip-text-color);
            background: var(--tooltip-bg);
            padding: var(--tooltip-padding-y) var(--tooltip-padding-x);
            border-radius: var(--toolptip-border-radius);
            pointer-events: none;
            transition: all var(--tooltip-transition-duration, 0.3s) cubic-bezier(0.68, -0.55, 0.265, 1.55);
            z-index: 1000;
        }

        .tooltip::before {
            content: attr(data-text-initial);
        }

        .tooltip::after {
            content: "";
            width: var(--tooltip-padding-y);
            height: var(--tooltip-padding-y);
            background: inherit;
            position: absolute;
            top: 50%;
            left: calc(var(--tooltip-padding-y) / 2 * -1);
            transform: translateY(-50%) rotate(45deg);
            z-index: -999;
            pointer-events: none;
        }

        .copy-button svg {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
        }

        .checkmark,
        .failedmark {
            display: none;
        }

        .copy-button:hover .tooltip,
        .copy-button:focus:not(:focus-visible) .tooltip {
            opacity: 1;
            visibility: visible;
        }

        .copy-button:focus:not(:focus-visible) .tooltip::before {
            content: attr(data-text-end);
        }
        .copy-button.copy-failed:focus:not(:focus-visible) .tooltip::before {
            content: attr(data-text-failed);
        }

        .copy-button:focus:not(:focus-visible) .clipboard {
            display: none;
        }

        .copy-button:focus:not(:focus-visible) .checkmark {
            display: block;
        }

        .copy-button.copy-failed:focus:not(:focus-visible) .checkmark {
            display: none;
        }

        .copy-button.copy-failed:focus:not(:focus-visible) .failedmark {
            display: block;
        }

        .copy-button:hover,
        .copy-button:focus {
            background-color: var(--button-hover-bg);
        }

        .copy-button:active {
            outline: var(--button-outline-width) solid var(--button-outline-color);
        }

        .copy-button:hover svg {
            color: var(--button-hover-text-color);
        }

        @keyframes pulse {
          0%, 100% {
            opacity: 1;
          }
          50% {
            opacity: 0.6;
          }
        }

        /* 当按钮处于 loading 状态时，应用脉冲动画 */
        .copy-button.loading {
          animation: pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
        }

        .copy-button.loading .checkmark,
        .copy-button.loading .failedmark {
            display: none; /* Loading 时隐藏对勾和叉号 */
        }

        /* 设置界面样式 - 使用 dialog 标签 */
        .linuxdo-settings-dialog {
            border: none;
            border-radius: 12px;
            padding: 0;
            width: 90%;
            max-width: 520px;
            max-height: 85vh;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: transparent;
            overflow: visible;
        }

        .linuxdo-settings-dialog::backdrop {
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(4px);
            animation: fadeIn 0.2s ease-out;
        }

        .linuxdo-settings-content {
            background: white;
            border-radius: 12px;
            padding: 28px;
            overflow-y: auto;
            max-height: 85vh;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
            position: relative;
            animation: slideIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        }

        html[style*="color-scheme: dark"] .linuxdo-settings-content {
            background: #2d2d2d;
            color: #fff;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
        }

        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }

        @keyframes slideIn {
            from {
                opacity: 0;
                transform: scale(0.9) translateY(-20px);
            }
            to {
                opacity: 1;
                transform: scale(1) translateY(0);
            }
        }

        .linuxdo-settings-dialog[closing] {
            animation: slideOut 0.2s ease-in forwards;
        }

        .linuxdo-settings-dialog[closing]::backdrop {
            animation: fadeOut 0.2s ease-in forwards;
        }

        @keyframes slideOut {
            from {
                opacity: 1;
                transform: scale(1) translateY(0);
            }
            to {
                opacity: 0;
                transform: scale(0.95) translateY(-10px);
            }
        }

        @keyframes fadeOut {
            from { opacity: 1; }
            to { opacity: 0; }
        }

        .linuxdo-settings-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 2px solid #f0f0f0;
            position: relative;
        }

        html[style*="color-scheme: dark"] .linuxdo-settings-header {
            border-bottom-color: #404040;
        }

        .linuxdo-settings-title {
            font-size: 20px;
            font-weight: 700;
            margin: 0;
            color: #1a1a1a;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        html[style*="color-scheme: dark"] .linuxdo-settings-title {
            background: linear-gradient(135deg, #8bb9fe 0%, #a8c8ff 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .linuxdo-settings-close {
            background: #f8f9fa;
            border: 1px solid #e9ecef;
            font-size: 18px;
            cursor: pointer;
            color: #6c757d;
            padding: 0;
            width: 36px;
            height: 36px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 8px;
            transition: all 0.2s ease;
            position: relative;
            overflow: hidden;
        }

        .linuxdo-settings-close::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
            transition: left 0.5s;
        }

        .linuxdo-settings-close:hover {
            background: #e9ecef;
            color: #495057;
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }

        .linuxdo-settings-close:hover::before {
            left: 100%;
        }

        .linuxdo-settings-close:active {
            transform: translateY(0);
            box-shadow: 0 2px 6px rgba(0,0,0,0.1);
        }

        html[style*="color-scheme: dark"] .linuxdo-settings-close {
            background: #404040;
            border-color: #555;
            color: #ccc;
        }

        html[style*="color-scheme: dark"] .linuxdo-settings-close:hover {
            background: #4a4a4a;
            color: #fff;
        }

        .linuxdo-settings-form {
            display: flex;
            flex-direction: column;
            gap: 20px;
        }

        .linuxdo-settings-field {
            display: flex;
            flex-direction: column;
            gap: 8px;
            position: relative;
        }

        .linuxdo-settings-label {
            font-weight: 600;
            font-size: 14px;
            color: #374151;
            margin-bottom: 4px;
        }

        html[style*="color-scheme: dark"] .linuxdo-settings-label {
            color: #d1d5db;
        }
        
        .linuxdo-settings-input,
        .linuxdo-settings-textarea {
            width: 100%;
        }
        .linuxdo-settings-input,
        .linuxdo-settings-select,
        .linuxdo-settings-textarea {
            padding: 12px 16px;
            border: 2px solid #e5e7eb;
            border-radius: 8px;
            font-size: 14px;
            font-family: inherit;
            transition: all 0.2s ease;
            background: #ffffff;
            color: #374151;
            margin-bottom: 0px !important;
            height: 48px;
        }

        .linuxdo-settings-input:focus,
        .linuxdo-settings-select:focus,
        .linuxdo-settings-textarea:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
            transform: translateY(-1px);
        }

        html[style*="color-scheme: dark"] .linuxdo-settings-input,
        html[style*="color-scheme: dark"] .linuxdo-settings-select,
        html[style*="color-scheme: dark"] .linuxdo-settings-textarea {
            background: #374151;
            border-color: #4b5563;
            color: #f9fafb;
        }

        html[style*="color-scheme: dark"] .linuxdo-settings-input:focus,
        html[style*="color-scheme: dark"] .linuxdo-settings-select:focus,
        html[style*="color-scheme: dark"] .linuxdo-settings-textarea:focus {
            border-color: #8bb9fe;
            box-shadow: 0 0 0 3px rgba(139, 185, 254, 0.1);
        }

        .linuxdo-settings-textarea {
            resize: vertical;
            min-height: 100px;
            line-height: 1.5;
        }

        .linuxdo-settings-checkbox,
        .linuxdo-settings-label {
            margin: 0px !important;
        }

        .linuxdo-settings-checkbox-wrapper {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 0;
            cursor: pointer;
            border-radius: 8px;
            transition: background-color 0.2s ease;
        }

        .linuxdo-settings-checkbox-wrapper:hover {
            background-color: rgba(102, 126, 234, 0.05);
        }

        html[style*="color-scheme: dark"] .linuxdo-settings-checkbox-wrapper:hover {
            background-color: rgba(139, 185, 254, 0.05);
        }

        .linuxdo-settings-checkbox {
            width: 20px;
            height: 20px;
            border: 2px solid #d1d5db;
            border-radius: 4px;
            background: white;
            cursor: pointer;
            transition: all 0.2s ease;
            position: relative;
        }

        .linuxdo-settings-checkbox:checked {
            background: #667eea;
            border-color: #667eea;
        }

        .linuxdo-settings-checkbox:checked::after {
            content: '✓';
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: white;
            font-size: 12px;
            font-weight: bold;
        }

        html[style*="color-scheme: dark"] .linuxdo-settings-checkbox {
            border-color: #6b7280;
            background: #374151;
        }

        html[style*="color-scheme: dark"] .linuxdo-settings-checkbox:checked {
            background: #8bb9fe;
            border-color: #8bb9fe;
        }

        .linuxdo-settings-buttons {
            display: flex;
            gap: 12px;
            justify-content: flex-end;
            margin-top: 20px;
            padding-top: 16px;
            border-top: 1px solid #e5e5e5;
        }

        html[style*="color-scheme: dark"] .linuxdo-settings-buttons {
            border-top-color: #444;
        }

        .linuxdo-settings-button {
            padding: 8px 16px;
            border: 1px solid #ddd;
            border-radius: 4px;
            background: white;
            color: #333;
            cursor: pointer;
            font-size: 14px;
            font-family: inherit;
        }

        .linuxdo-settings-button:hover {
            background: #f5f5f5;
        }

        .linuxdo-settings-button.primary {
            background: #007bff;
            color: white;
            border-color: #007bff;
        }

        .linuxdo-settings-button.primary:hover {
            background: #0056b3;
            border-color: #0056b3;
        }

        html[style*="color-scheme: dark"] .linuxdo-settings-button {
            background: #3a3a3a;
            border-color: #555;
            color: #fff;
        }

        html[style*="color-scheme: dark"] .linuxdo-settings-button:hover {
            background: #444;
        }

        .linuxdo-settings-description {
            font-size: 12px;
            color: #666;
            margin-top: 4px;
        }

        html[style*="color-scheme: dark"] .linuxdo-settings-description {
            color: #999;
        }

        .linuxdo-model-input-wrapper {
            display: flex;
            gap: 12px;
            align-items: stretch;
        }

        .linuxdo-model-input-wrapper .linuxdo-settings-select {
            flex: 1;
        }

        .linuxdo-model-input-wrapper .linuxdo-settings-input {
            flex: 1;
            display: none;
        }

        .linuxdo-model-input-wrapper.custom-input .linuxdo-settings-select {
            display: none;
        }

        .linuxdo-model-input-wrapper.custom-input .linuxdo-settings-input {
            display: block;
        }

        .linuxdo-model-toggle {
            padding: 8px 16px;
            font-size: 13px;
            font-weight: 600;
            background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
            border: 2px solid #dee2e6;
            border-radius: 8px;
            cursor: pointer;
            white-space: nowrap;
            transition: all 0.2s ease;
            color: #495057;
            min-width: 80px;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .linuxdo-model-toggle:hover {
            background: linear-gradient(135deg, #e9ecef 0%, #dee2e6 100%);
            transform: translateY(-1px);
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }

        .linuxdo-model-toggle:active {
            transform: translateY(0);
            box-shadow: 0 1px 4px rgba(0,0,0,0.1);
        }

        html[style*="color-scheme: dark"] .linuxdo-model-toggle {
            background: linear-gradient(135deg, #4b5563 0%, #374151 100%);
            border-color: #6b7280;
            color: #f9fafb;
        }

        html[style*="color-scheme: dark"] .linuxdo-model-toggle:hover {
            background: linear-gradient(135deg, #6b7280 0%, #4b5563 100%);
        }
    `;

  /**
   * 添加样式到页面，优先使用 GM_addStyle，否则使用 DOM 方法。
   * @param {string} cssText - CSS 文本。
   */
  function addStyle(cssText) {
    if (typeof GM_addStyle !== 'undefined') {
      GM_addStyle(cssText);
    } else {
      const styleNode = document.createElement('style');
      styleNode.appendChild(document.createTextNode(cssText));
      (document.head || document.documentElement).appendChild(styleNode);
    }
  }

  // 应用样式
  addStyle(copyBtnStyle);

  // ==========================================================
  // 设置界面相关函数
  // ==========================================================

  // 预定义的模型选项
  const PREDEFINED_MODELS = [
    'gemini-2.0-flash-lite',
    'gemini-2.5-pro',
    'gemini-2.5-flash'
  ];

  /**
   * 创建设置界面 - 使用 dialog 标签
   */
  function createSettingsModal() {
    const dialog = document.createElement('dialog');
    dialog.className = 'linuxdo-settings-dialog';

    const currentModel = getConfig('GEMINI_MODEL');
    const isCustomModel = !PREDEFINED_MODELS.includes(currentModel);

    dialog.innerHTML = `
      <div class="linuxdo-settings-content">
        <div class="linuxdo-settings-header">
          <h2 class="linuxdo-settings-title">LinuxDo 分享助手设置</h2>
          <button class="linuxdo-settings-close" type="button">&times;</button>
        </div>
        <form class="linuxdo-settings-form" method="dialog">
          <div class="linuxdo-settings-field">
            <div class="linuxdo-settings-checkbox-wrapper">
              <input type="checkbox" id="useGeminiApi" class="linuxdo-settings-checkbox" ${getConfig('USE_GEMINI_API_FOR_SUMMARY') ? 'checked' : ''}>
              <label for="useGeminiApi" class="linuxdo-settings-label">启用 AI 自动总结</label>
            </div>
            <div class="linuxdo-settings-description">开启后将使用 Gemini API 对文章内容进行智能总结</div>
          </div>

          <div class="linuxdo-settings-field">
            <label for="geminiApiKey" class="linuxdo-settings-label">Gemini API Key</label>
            <input type="password" id="geminiApiKey" class="linuxdo-settings-input" value="${getConfig('GEMINI_API_KEY')}" placeholder="请输入您的 Gemini API Key">
          </div>

          <div class="linuxdo-settings-field">
            <label for="geminiModel" class="linuxdo-settings-label">AI 模型</label>
            <div class="linuxdo-model-input-wrapper ${isCustomModel ? 'custom-input' : ''}">
              <select id="geminiModelSelect" class="linuxdo-settings-select">
                ${PREDEFINED_MODELS.map(model =>
                  `<option value="${model}" ${model === currentModel ? 'selected' : ''}>${model}</option>`
                ).join('')}
              </select>
              <input type="text" id="geminiModelInput" class="linuxdo-settings-input" value="${isCustomModel ? currentModel : ''}" placeholder="输入自定义模型名称">
              <button type="button" class="linuxdo-model-toggle">${isCustomModel ? '预设' : '自定义'}</button>
            </div>
            <div class="linuxdo-settings-description">选择要使用的 Gemini 模型，或输入自定义模型名称</div>
          </div>

          <div class="linuxdo-settings-field">
            <label for="localSummaryMaxChars" class="linuxdo-settings-label">本地总结最大字符数</label>
            <input type="number" id="localSummaryMaxChars" class="linuxdo-settings-input" value="${getConfig('LOCAL_SUMMARY_MAX_CHARS')}" placeholder="140" min="1" max="10000">
            <div class="linuxdo-settings-description">设置本地内容总结的最大字符数，范围：1-10000</div>
          </div>

          <div class="linuxdo-settings-field">
            <label for="customPrompt" class="linuxdo-settings-label">自定义总结 Prompt</label>
            <textarea id="customPrompt" class="linuxdo-settings-textarea" placeholder="输入自定义的总结提示词">${getConfig('CUSTOM_SUMMARY_PROMPT')}</textarea>
            <div class="linuxdo-settings-description">可以使用 {content} 作为占位符，代表帖子正文内容</div>
          </div>

          <div class="linuxdo-settings-buttons">
            <button type="button" class="linuxdo-settings-button" id="cancelSettings">取消</button>
            <button type="button" class="linuxdo-settings-button primary" id="saveSettings">保存</button>
          </div>
        </form>
      </div>
    `;

    return dialog;
  }

  /**
   * 显示设置界面 - 使用 dialog API
   */
  function showSettingsModal() {
    // 确保只在主窗口中显示设置界面，避免在 iframe 中显示
    if (window !== window.top) {
      console.log('在 iframe 中，跳过显示设置界面');
      return;
    }

    // 移除已存在的对话框
    const existingDialog = document.querySelector('.linuxdo-settings-dialog');
    if (existingDialog) {
      existingDialog.remove();
    }

    const dialog = createSettingsModal();
    document.body.appendChild(dialog);

    // 绑定事件
    bindSettingsEvents(dialog);

    // 检查浏览器是否支持 dialog
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      // 降级处理：对于不支持 dialog 的浏览器
      dialog.style.display = 'block';
      dialog.style.position = 'fixed';
      dialog.style.top = '50%';
      dialog.style.left = '50%';
      dialog.style.transform = 'translate(-50%, -50%)';
      dialog.style.zIndex = '10000';
      
      // 创建背景遮罩
      const backdrop = document.createElement('div');
      backdrop.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.6);
        z-index: 9999;
      `;
      backdrop.className = 'dialog-backdrop-fallback';
      document.body.appendChild(backdrop);
      
      console.warn('浏览器不支持 dialog 元素，使用降级方案');
    }
  }

  /**
   * 绑定设置界面事件 - 使用 dialog API
   */
  function bindSettingsEvents(dialog) {
    const closeBtn = dialog.querySelector('.linuxdo-settings-close');
    const cancelBtn = dialog.querySelector('#cancelSettings');
    const saveBtn = dialog.querySelector('#saveSettings');
    const modelToggle = dialog.querySelector('.linuxdo-model-toggle');
    const modelWrapper = dialog.querySelector('.linuxdo-model-input-wrapper');

    // 关闭对话框的函数
    const closeDialog = () => {
      if (typeof dialog.close === 'function') {
        // 添加关闭动画
        dialog.setAttribute('closing', '');
        setTimeout(() => {
          dialog.close();
          dialog.remove();
        }, 200);
      } else {
        // 降级处理
        dialog.remove();
        const backdrop = document.querySelector('.dialog-backdrop-fallback');
        if (backdrop) backdrop.remove();
      }
    };

    // 绑定关闭事件
    closeBtn.addEventListener('click', closeDialog);
    cancelBtn.addEventListener('click', closeDialog);

    // 点击背景关闭 (对于支持 dialog 的浏览器)
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        closeDialog();
      }
    });

    // ESC 键关闭处理
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault(); // 阻止默认的 ESC 关闭行为
      closeDialog(); // 使用我们的关闭动画
    });

    // 模型选择切换
    modelToggle.addEventListener('click', () => {
      const isCustom = modelWrapper.classList.contains('custom-input');
      if (isCustom) {
        modelWrapper.classList.remove('custom-input');
        modelToggle.textContent = '自定义';
      } else {
        modelWrapper.classList.add('custom-input');
        modelToggle.textContent = '预设';
      }
    });

    // 保存设置
    saveBtn.addEventListener('click', (e) => {
      e.preventDefault(); // 阻止表单提交
      
      const useGeminiApi = dialog.querySelector('#useGeminiApi').checked;
      const apiKey = dialog.querySelector('#geminiApiKey').value.trim();
      const localSummaryMaxChars = parseInt(dialog.querySelector('#localSummaryMaxChars').value.trim()) || DEFAULT_CONFIG.LOCAL_SUMMARY_MAX_CHARS;
      const customPrompt = dialog.querySelector('#customPrompt').value.trim();

      // 获取模型值
      let modelValue;
      if (modelWrapper.classList.contains('custom-input')) {
        modelValue = dialog.querySelector('#geminiModelInput').value.trim();
      } else {
        modelValue = dialog.querySelector('#geminiModelSelect').value;
      }

      // 保存配置
      setConfig('USE_GEMINI_API_FOR_SUMMARY', useGeminiApi);
      setConfig('GEMINI_API_KEY', apiKey);
      setConfig('GEMINI_MODEL', modelValue || DEFAULT_CONFIG.GEMINI_MODEL);
      setConfig('LOCAL_SUMMARY_MAX_CHARS', localSummaryMaxChars);
      setConfig('CUSTOM_SUMMARY_PROMPT', customPrompt || DEFAULT_CONFIG.CUSTOM_SUMMARY_PROMPT);

      // 显示保存成功提示
      const originalText = saveBtn.textContent;
      saveBtn.textContent = '已保存 ✓';
      saveBtn.disabled = true;
      
      setTimeout(() => {
        closeDialog();
      }, 1200);
    });

    // 为降级方案添加背景点击关闭
    if (typeof dialog.showModal !== 'function') {
      const backdrop = document.querySelector('.dialog-backdrop-fallback');
      if (backdrop) {
        backdrop.addEventListener('click', closeDialog);
      }
    }
  }

  // 只在主窗口中注册油猴菜单命令，避免在 iframe 中重复注册
  if (window === window.top) {
    GM_registerMenuCommand('设置', showSettingsModal);
  }

  // ==========================================================
  // 辅助函数 (用于API调用)
  // ==========================================================
  async function callGeminiAPI(prompt, apiKey, model = 'gemini-2.5-flash-lite') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const headers = {
      'Content-Type': 'application/json'
    };
    const body = JSON.stringify({
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.7, // 调整生成温度
        topP: 0.9,
        topK: 40
      }
    });

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: url,
        headers: headers,
        data: body,
        onload: function (response) {
          try {
            const data = JSON.parse(response.responseText);
            if (data.candidates && data.candidates.length > 0) {
              resolve(data.candidates[0].content.parts[0].text);
            } else if (data.error) {
              reject(new Error(`Gemini API Error: ${data.error.message}`));
            } else {
              reject(new Error('Gemini API returned an unexpected response.'));
            }
          } catch (e) {
            reject(new Error('Failed to parse Gemini API response: ' + e.message + '\nResponse: ' + response.responseText));
          }
        },
        onerror: function (error) {
          reject(new Error('GM_xmlhttpRequest failed: ' + error.statusText || 'Unknown error'));
        }
      });
    });
  }

  // ==========================================================
  // 复制和错误处理函数 (通用化)
  // ==========================================================
  /**
   * 处理复制失败。
   * @param {Object} param - 包含相关元素的参数对象。
   * @param {Element} param.element - 触发复制的按钮元素。
   * @param {Error} param.error - 错误对象。
   */
  function handleCopyError({ element, error = new Error() }) {
    element.classList.add('copy-failed');
    console.error('复制失败:', error);
    setTimeout(() => {
      element.classList.remove('copy-failed');
      element.blur(); // 移除焦点，重置提示
    }, 3000); // 3秒后移除失败提示
  }

  /**
   * 将文本复制到剪贴板。
   * @param {Object} param - 包含相关元素的参数对象。
   * @param {Element} param.element - 触发复制的按钮元素。
   * @param {string} param.text - 要复制的文本。
   */
  function copyTextToClipboard({ element, text }) {
    navigator.clipboard.writeText(text).then(function () {
      console.log('文本已复制到剪贴板');
      console.log(text);
      element.focus(); // 触发 :focus 样式显示“已复制”
      setTimeout(() => {
        element.blur(); // 移除焦点，重置提示
      }, 2000); // 2秒后移除成功提示
    }).catch(function (error) {
      handleCopyError({ element, error });
    });
  }

  // ==========================================================
  // 主要数据获取函数
  // ==========================================================
  /**
   * 从文章的DOM元素中提取数据，包括板块、标题、链接、标签和内容总结。
   * @param {Element} titleElement 文章标题的a.fancy-title元素。
   * @param {Element} articleRootElement 文章的主内容DOM元素，例如 .cooked。
   * @returns {Promise<Object>} 包含文章数据的Promise。
   */
  async function getArticleData(titleElement, articleRootElement) {
    const userData = getUserData(); // 获取用户、分类、标签数据

    const articleData = {
      ...userData, // 合并用户、分类和标签数据
      title: '',
      link: '',
      summary: '',
    };

    if (titleElement) {
      // 直接获取 <a> 标签的文本内容，通常它直接包含标题
      let titleText = titleElement.textContent.trim();
      let titleLink = titleElement.href || '';
      articleData.title = titleText;
      articleData.link = titleLink;
    }

    // 获取内容并进行总结
    if (articleRootElement) {
      // 克隆元素，以便在处理时移除不必要的节点，不影响原页面
      const clonedArticleContent = articleRootElement.cloneNode(true);

      // 移除通常不用于总结的内容元素
      // 根据实际情况调整这些选择器，以排除掉不需要总结的部分
      clonedArticleContent.querySelectorAll(
        'pre, code, blockquote, img, .meta, .discourse-footnote-link, .emoji, ' +
        '.signature, .system-message, .post-links, .hidden'
      ).forEach(el => el.remove());

      let fullTextContent = clonedArticleContent.textContent.trim();
      // 清理多余的换行和空白字符
      fullTextContent = fullTextContent.replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n\n').trim();

      if (CONFIG.USE_GEMINI_API_FOR_SUMMARY && CONFIG.GEMINI_API_KEY) {
        console.log('尝试使用 Gemini API 总结内容...');
        // 截取前4000字符发送给API，避免过长导致请求失败或费用过高
        const contentToSummarize = fullTextContent.substring(0, 4000);
        const customPrompt = CONFIG.CUSTOM_SUMMARY_PROMPT || DEFAULT_CONFIG.CUSTOM_SUMMARY_PROMPT;
        const prompt = customPrompt
          .replace('{maxChars}', CONFIG.LOCAL_SUMMARY_MAX_CHARS)
          .replace('{content}', contentToSummarize);

        try {
          articleData.summary = await callGeminiAPI(prompt, CONFIG.GEMINI_API_KEY, CONFIG.GEMINI_MODEL);
          console.log('Gemini API 总结:', articleData.summary);
          // 清理 Gemini 返回的可能多余的格式或问候语
          articleData.summary = articleData.summary.replace(/^(.)\s*(\S+)/, '$1$2').trim();
        } catch (error) {
          console.error('Gemini API 总结失败:', error);
          // API 失败时，回退到本地截取
          articleData.summary = fullTextContent.substring(0, CONFIG.LOCAL_SUMMARY_MAX_CHARS) + (fullTextContent.length > CONFIG.LOCAL_SUMMARY_MAX_CHARS ? '...' : '');
        }
      } else {
        // 本地简单截取
        articleData.summary = fullTextContent.substring(0, CONFIG.LOCAL_SUMMARY_MAX_CHARS) + (fullTextContent.length > CONFIG.LOCAL_SUMMARY_MAX_CHARS ? '...' : '');
        if (!CONFIG.GEMINI_API_KEY && CONFIG.USE_GEMINI_API_FOR_SUMMARY) {
          console.warn('未提供 Gemini API Key 或未启用 API 总结，将使用本地简单截取。');
        }
      }
    }

    return articleData;
  }

  /**
   * 从文章的DOM元素中提取用户数据，包括用户名、用户头衔、板块和标签。
   * @returns {Object} 包含用户数据的对象。
   * @property {string} username - 用户名。
   * @property {string} category - 文章所属板块。
   */
  function getUserData() {
    const userData = {
      username: '',
      category: '', // 统一使用 category
    };

    // 获取板块名称
    const categoryElement = document.querySelector('.badge-category__name');
    if (categoryElement) {
      userData.category = categoryElement.textContent.trim();
    }

    // 获取用户名和用户头衔
    // Discourse 中，发帖人的信息通常在 .topic-meta-data 或 .post-stream .post:first-of-type .main-post-list-item 内部
    const postAuthorContainer = document.querySelector('.topic-meta-data, .post-stream .post:first-of-type');
    if (postAuthorContainer) {
      const usernameElement = postAuthorContainer.querySelector('.names .first.full-name a, .username a');
      if (usernameElement) {
        userData.username = usernameElement.textContent.trim();
      }
    }

    return userData;
  }


  // ==========================================================
  // 新增：在标题后添加复制按钮
  // ==========================================================
  /**
   * 在文章标题后添加复制按钮。
   * @param {Element} titleElement - 文章标题的a.fancy-title元素。
   * @param {Element} articleRootElement - 包含文章所有信息的根DOM元素。
   */
  function addCopyButtonToArticleTitle(titleElement, articleRootElement) {
    // 检查是否已经添加了复制按钮，避免重复
    if (titleElement.nextElementSibling && titleElement.nextElementSibling.classList.contains('article-copy-button')) {
      console.log('复制按钮已存在，跳过添加。');
      return;
    }

    const copyButton = document.createElement('button');
    copyButton.className = 'copy-button article-copy-button'; // 使用通用样式，并添加特有类
    copyButton.innerHTML = /*html*/`
            <span data-text-initial="复制文章信息" data-text-end="已复制" data-text-failed="复制失败" class="tooltip"></span>
            <span>
                <svg xml:space="preserve" style="enable-background:new 0 0 512 512" viewBox="0 0 6.35 6.35" y="0" x="0"
                    height="14" width="14" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1"
                    xmlns="http://www.w3.org/2000/svg" class="clipboard">
                    <g>
                        <path fill="currentColor"
                            d="M2.43.265c-.3 0-.548.236-.573.53h-.328a.74.74 0 0 0-.735.734v3.822a.74.74 0 0 0 .735.734H4.82a.74.74 0 0 0 .735-.734V1.529a.74.74 0 0 0-.735-.735h-.328a.58.58 0 0 0-.573-.53zm0 .529h1.49c.032 0 .049.017.049.049v.431c0 .032-.017.049-.049.049H2.43c-.032 0-.05-.017-.05-.049V.843c0-.032.018-.05.05-.05zm-.901.53h.328c.026.292.274.528.573.528h1.49a.58.58 0 0 0 .573-.529h.328a.2.2 0 0 1 .206.206v3.822a.2.2 0 0 1-.206.205H1.53a.2.2 0 0 1-.206-.205V1.529a.2.2 0 0 1 .206-.206z">
                        </path>
                    </g>
                </svg>
                <svg xml:space="preserve" style="enable-background:new 0 0 512 512" viewBox="0 0 24 24" y="0" x="0" height="14"
                    width="14" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" xmlns="http://www.w3.org/2000/svg"
                    class="checkmark">
                    <g>
                        <path data-original="#000000" fill="currentColor"
                            d="M9.707 19.121a.997.997 0 0 1-1.414 0l-5.646-5.647a1.5 1.5 0 0 1 0-2.121l.707-.707a1.5 1.5 0 0 1 2.121 0L9 14.171l9.525-9.525a1.5 1.5 0 0 1 2.121 0l.707.707a1.5 1.5 0 0 1 0 2.121z">
                        </path>
                    </g>
                </svg>
                <svg class="failedmark" xmlns="http://www.w3.org/2000/svg" height="14" width="14" viewBox="0 0 512 512">
                    <path fill="#FF473E"
                        d="m330.443 256l136.765-136.765c14.058-14.058 14.058-36.85 0-50.908l-23.535-23.535c-14.058-14.058-36.85-14.058-50.908 0L256 181.557L119.235 44.792c-14.058-14.058-36.85-14.058-50.908 0L44.792 68.327c-14.058 14.058-14.058 36.85 0 50.908L181.557 256L44.792 392.765c-14.058 14.058-14.058 36.85 0 50.908l23.535 23.535c14.058 14.058 36.85 14.058 50.908 0L256 330.443l136.765 136.765c14.058 14.058 36.85 14.058 50.908 0l23.535-23.535c14.058-14.058 14.058-36.85 0-50.908z" />
                </svg>
            </span>
        `;

    // 插入到标题链接的后面
    titleElement.parentNode.insertBefore(copyButton, titleElement.nextSibling);

    copyButton.addEventListener('click', async (e) => {
      e.stopPropagation(); // 阻止点击按钮时跳转到文章链接

      // 避免在处理期间重复点击
      if (copyButton.classList.contains('loading')) {
        return;
      }

      // 1. 立即进入 Loading 状态
      copyButton.classList.add('loading');
      copyButton.disabled = true; // 禁用按钮，防止重复点击

      try {
        // 获取文章数据（这一步可能会因为API调用而耗时）
        const articleData = await getArticleData(titleElement, articleRootElement);
        console.log('获取到的文章数据:', articleData);

        // 根据模板格式化文本
        let formattedText = CONFIG.ARTICLE_COPY_TEMPLATE.replace(/{{(\w+)}}/g, (match, key) => {
          return articleData[key] !== undefined ? articleData[key] : match;
        });
        // 清理多余空行，保留一行空行
        formattedText = formattedText.replace(/\n\n+/g, '\n\n').trim();

        copyTextToClipboard({ element: copyButton, text: formattedText });
      } catch (error) {
        handleCopyError({ element: copyButton, error });
      } finally {
        // 3. 无论成功或失败，最后都移除 Loading 状态
        copyButton.classList.remove('loading');
        copyButton.disabled = false; // 重新启用按钮
      }
    });
  }

  // ==========================================================
  // 脚本执行入口
  // ==========================================================
  function initializeScript() {
    // 只在主窗口中运行脚本功能，避免在 iframe 中重复执行
    if (window !== window.top) {
      console.log("在 iframe 中，跳过脚本初始化");
      return;
    }

    console.log("油猴脚本已尝试初始化。");

    // 找到文章标题元素
    const titleLinkElement = document.querySelector('h1[data-topic-id] a.fancy-title');
    // 找到文章内容的主容器
    const articleRootElement = document.querySelector('.cooked');
    // 找到用户数据、分类和标签的必要元素，确保它们都已加载
    const userDataContainer = document.querySelector('.topic-meta-data');
    const categoryBadge = document.querySelector('.badge-category__name');

    // 只有当所有关键元素都存在时才进行操作
    if (titleLinkElement && articleRootElement && userDataContainer && categoryBadge) {
      // 确保标题的父元素 (h1) 设置为 flex 布局，以便按钮能正确对齐
      if (titleLinkElement.parentNode && titleLinkElement.parentNode.tagName === 'H1') {
        const parentH1 = titleLinkElement.parentNode;
        if (!parentH1.style.display || !parentH1.style.display.includes('flex')) {
          parentH1.style.display = 'flex';
          parentH1.style.alignItems = 'center';
          parentH1.style.gap = '8px'; // 添加间距
          console.log('已调整 H1 父元素样式为 flex。');
        }
      }

      addCopyButtonToArticleTitle(titleLinkElement, articleRootElement);

      // 调试用：立即获取文章数据并打印
      // getArticleData(titleLinkElement, articleRootElement).then(data => {
      //   console.log('首次获取到的文章数据:', data);
      // }).catch(error => {
      //   console.error('首次获取文章数据失败:', error);
      // });

    } else {
      console.log('部分所需元素未找到，等待DOM更新:', {
        title: !!titleLinkElement,
        content: !!articleRootElement,
        userData: !!userDataContainer,
        category: !!categoryBadge,
      });
    }
  }

  // 只在主窗口中初始化脚本功能
  if (window === window.top) {
    // 使用 MutationObserver 监听 DOM 变化，这对于动态加载内容的 SPA 非常重要
    const observer = new MutationObserver((mutationsList, observerInstance) => {
      // 每次 DOM 变化时都尝试运行初始化函数
      // initializeScript 内部会判断按钮是否已存在，防止重复添加
      initializeScript();
    });

    // 开始观察整个文档主体，包括子元素的添加/移除和子树的更改
    observer.observe(document.body, { childList: true, subtree: true });

    // 初始加载时也尝试运行一次，以防页面内容在脚本加载时已经就绪
    // @run-at document-idle 已经处理了大部分情况，这里是额外的保障
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', initializeScript);
    } else {
      initializeScript();
    }
  } else {
    console.log("在 iframe 中，跳过脚本功能初始化");
  }

})();


