// ==UserScript==
// @name          从linux do获取论坛文章数据与复制
// @namespace     http://tampermonkey.net/
// @version       0.15
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

  // #region 脚本配置与常量
  // ==========================================================

  /**
   * @description 默认配置项，当油猴存储中没有对应值时使用。
   */
  const DEFAULT_CONFIG = {
    // 是否启用 AI 进行内容总结
    USE_AI_FOR_SUMMARY: false,
    // AI 模式 gemini/openaiCompatible
    AI_MODE: 'gemini',
    // AI Key，如果 USE_AI_FOR_SUMMARY 为 true，则需要填写此项 获取:
    API_KEY: '',
    // AI 基础地址
    API_BASE_URL: 'https://generativelanguage.googleapis.com',
    // Gemini 模型名称
    MODEL_NAME: 'gemini-2.5-flash-lite',
    // 总结后的最大字符数
    LOCAL_SUMMARY_MAX_CHARS: 90,
    // 自定义总结 Prompt
    CUSTOM_SUMMARY_PROMPT: `你是一个信息获取专家，可以精准的总结文章的精华内容和重点，请对以下文章内容进行归纳总结，回复不要有对我的问候语，或者(你好这是我的总结)(总结)等类似废话，直接返回你的总结，长度不超过{maxChars}个字符（或尽可能短，保持中文语义完整）： {content}`,
    // 文章复制模板
    ARTICLE_COPY_TEMPLATE: [
      `{{title}}`,
      `@{{username}}-{{category}}/{{tags}}`,
      ``,
      `{{summary}}`,
      `{{link}}`,
    ].join('\n')
  };

  // #endregion

  // #region 配置管理
  // ==========================================================

  /**
   * @description 从油猴存储中获取指定键的配置值。
   * @param {string} key - 配置项的键名。
   * @returns {*} 对应配置项的值，如果不存在则返回默认值。
   */
  function getConfig(key) {
    return GM_getValue(key, DEFAULT_CONFIG[key]);
  }

  /**
   * @description 将配置值保存到油猴存储中。
   * @param {string} key - 配置项的键名。
   * @param {*} value - 要保存的配置值。
   */
  function setConfig(key, value) {
    GM_setValue(key, value);
  }

  /**
   * @description 创建一个动态配置代理对象。
   * 当访问 CONFIG.someKey 时，会自动调用 getConfig('someKey')。
   * 当设置 CONFIG.someKey = value 时，会自动调用 setConfig('someKey', value)。
   */
  const CONFIG = new Proxy({}, {
    get(target, prop) {
      return getConfig(prop);
    },
    set(target, prop, value) {
      setConfig(prop, value);
      return true;
    }
  });
  // #endregion

  // #region 样式注入
  // ==========================================================

  /**
   * @description 脚本所需的全部 CSS 样式字符串。
   */
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
        .linuxdo-settings-textarea:focus {
            outline: none;
            border-color: #667eea;
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
            transform: translateY(-1px);
        }

        html[style*="color-scheme: dark"] .linuxdo-settings-input,
        html[style*="color-scheme: dark"] .linuxdo-settings-textarea {
            background: #374151;
            border-color: #4b5563;
            color: #f9fafb;
        }

        html[style*="color-scheme: dark"] .linuxdo-settings-input:focus,
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


        .linuxdo-model-input-wrapper .linuxdo-settings-input {
            flex: 1;
            display: none;
        }

        .linuxdo-model-input-wrapper.custom-input .linuxdo-settings-input {
            display: block;
        }
    `;

  /**
   * @description 将 CSS 样式注入到页面中。
   * 优先使用 GM_addStyle API，如果不可用，则创建一个 <style> 标签并插入到 <head> 中。
   * @param {string} cssText - 要注入的 CSS 样式字符串。
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
  // #endregion

  // #region 通用辅助函数
  // ==========================================================

  /**
   * @description 调用 AI 以获取内容总结。
   * @param {string} prompt - 发送给 API 的完整提示词。
   * @param {string} apiKey -用户的 AI Key。
   * @param {string} [model='gemini-2.5-flash-lite'] - 要使用的 Gemini 模型名称。
   * @returns {Promise<string>} 返回 API 生成的文本内容的 Promise。
   */
  async function callAiAPI(prompt, apiKey, model = 'gemini-2.5-flash-lite') {
    const aiMode = CONFIG.AI_MODE || DEFAULT_CONFIG.AI_MODE;

    const baseUrl = CONFIG.API_BASE_URL || DEFAULT_CONFIG.API_BASE_URL;

    // gemini
    if (aiMode === 'gemini') {
      const url = `${baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`;
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
                reject(new Error(`AI Error: ${data.error.message}`));
              } else {
                reject(new Error('AI returned an unexpected response.' + JSON.stringify(response)));
              }
            } catch (e) {
              reject(new Error('Failed to parse AI response: ' + e.message + '\nResponse: ' + response.responseText));
            }
          },
          onerror: function (error) {
            reject(new Error('GM_xmlhttpRequest failed: ' + error.statusText || 'Unknown error'));
          }
        });
      });
    } else if (aiMode === 'openaiCompatible') {
      const url = baseUrl;
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      };
      const body = JSON.stringify({
        model: model,
        messages: [{
          role: 'user',
          content: prompt
        }]
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
              if (data.choices && data.choices.length > 0) {
                resolve(data.choices[0].message.content);
              } else if (data.error) {
                reject(new Error(`AI Error: ${data.error.message}`));
              } else {
                reject(new Error('AI returned an unexpected response.'));
              }
            } catch (e) {
              reject(new Error('Failed to parse AI response: ' + e.message + '\nResponse: ' + response.responseText));
            }
          },
          onerror: function (error) {
            reject(new Error('GM_xmlhttpRequest failed: ' + error.statusText || 'Unknown error'));
          }
        });
      });
    }
  }

  /**
   * @description 处理复制操作失败后的 UI 反馈。
   * @param {object} param - 参数对象。
   * @param {HTMLElement} param.element - 触发复制操作的按钮元素。
   * @param {Error} [param.error=new Error()] - 捕获到的错误对象。
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
   * @description 将指定的文本复制到用户的剪贴板。
   * @param {object} param - 参数对象。
   * @param {HTMLElement} param.element - 触发复制操作的按钮元素。
   * @param {string} param.text - 要复制到剪贴板的文本。
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
  /**
   * @description 节流函数
   * @param {Function} func - 要节流的函数
   * @param {number} delay - 节流的延迟时间(毫秒)
   * @returns {Function} 节流后的函数
   */
  function throttle(func, delay) {
    let timer;
    function throttled(...param) {
      if (timer) return;
      timer = setTimeout(() => {
        func.apply(this, param);
        clearTimeout(timer);
        timer = null;
      }, delay);
    }
    return throttled;
  }
  /**
   * 创建一个节流函数，在 wait 秒内最多执行 func 一次。
   * 该函数提供一个 options 对象来决定是否应禁用前缘或后缘的调用。
   *
   * @param {Function} func 要节流的函数。
   * @param {number} wait 等待的毫秒数。
   * @param {object} [options={}] 选项对象。
   * @param {boolean} [options.leading=true] 指定在节流开始前（前缘）调用。
   * @param {boolean} [options.trailing=true] 指定在节流结束后（后缘）调用。
   * @returns {Function} 返回新的节流函数。
   */
  function throttleFormGemini(func, wait, options = {}) {
    let timeout = null;
    let lastArgs = null;
    let lastThis = null;
    let result;
    let previous = 0; // 上次执行的时间戳

    // 默认开启 leading 和 trailing，trailing 默认开启以保持您之前版本的功能性
    const { leading = true, trailing = true } = options;

    // 如果 wait 小于等于 0，则无论如何都立即执行
    if (wait <= 0) {
      return (...args) => func.apply(this, args);
    }

    // 定时器触发时执行的函数，用于处理 trailing 调用
    function later() {
      // 如果 leading 为 false，则重置 previous，允许在静默期后立即触发下一次 leading
      // 否则，将 previous 设为当前时间，作为新的节流周期的开始
      previous = leading === false ? 0 : Date.now();
      timeout = null;

      // 如果在节流期间有新的调用，则执行最后一次调用
      if (lastArgs) {
        result = func.apply(lastThis, lastArgs);
        // 清理，防止内存泄漏
        if (!timeout) {
          lastThis = lastArgs = null;
        }
      }
    }

    // 返回的节流函数
    function throttled(...args) {
      const now = Date.now();

      // 如果是第一次调用，且禁用了 leading，则记录当前时间戳作为节流周期的开始
      if (!previous && leading === false) {
        previous = now;
      }

      // 计算距离下次可执行的时间
      const remaining = wait - (now - previous);
      lastArgs = args;
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      lastThis = this;

      // ---- 核心判断逻辑 ----
      // 1. 时间已到 (remaining <= 0) 或 2. 系统时间被向后调整 (remaining > wait)
      if (remaining <= 0 || remaining > wait) {
        // 清除可能存在的 trailing 定时器，因为我们要立即执行
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        // 更新时间戳，开始新的节流周期
        previous = now;
        // 立即执行（leading call）
        result = func.apply(lastThis, lastArgs);
        if (!timeout) {
          lastThis = lastArgs = null;
        }
      } else if (!timeout && trailing !== false) {
        // 如果时间未到，且没有设置定时器，并且需要 trailing 调用
        // 则设置一个定时器，在剩余时间后执行 later 函数
        timeout = setTimeout(later, remaining);
      }

      // 返回上一次执行的结果
      return result;
    }

    // 添加取消功能
    throttled.cancel = () => {
      clearTimeout(timeout);
      previous = 0;
      timeout = lastThis = lastArgs = null;
    };

    return throttled;
  }

  // #endregion

  // #region 核心数据提取
  // ==========================================================

  /**
   * @description 从页面 DOM 中提取当前文章的作者、分类和标签信息。
   * @returns {{username: string, category: string, tags: string}} 包含用户、分类和标签数据的对象。
   */
  function getUserData() {
    const userData = {
      username: '',
      category: '', // 统一使用 category
      tags: '',
    };

    // 获取板块名称
    const categoryElement = document.querySelectorAll('.topic-category .badge-category__wrapper');
    if (categoryElement) {
      const categoryArr = Array.from(categoryElement);
      const lastIndex = categoryArr.length - 1;
      userData.category = categoryArr[lastIndex].textContent.trim();
    }

    // 获取用户名
    const postAuthorContainer = document.querySelector('.topic-meta-data, .post-stream .post:first-of-type');
    if (postAuthorContainer) {
      const usernameElement = postAuthorContainer.querySelector('.names .first.full-name a, .username a');
      if (usernameElement) {
        userData.username = usernameElement.textContent.trim();
      }
    }

    // 获取标签
    const TagsElement = document.querySelector('.list-tags');
    if (TagsElement) {
      userData.tags = TagsElement.textContent.trim();
    }

    return userData;
  }

  /**
   * @description 从页面 DOM 中提取并整合文章的完整数据。
   * @param {HTMLElement} titleElement - 文章标题的 <a> 元素。
   * @param {HTMLElement} articleRootElement - 文章内容的根元素 (通常是 .cooked)。
   * @returns {Promise<object>} 返回一个包含文章所有数据的 Promise 对象。
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
      articleData.title = titleElement.textContent.trim();
      articleData.link = titleElement.href || '';
    }

    // 获取内容并进行总结
    if (articleRootElement) {
      const clonedArticleContent = articleRootElement.cloneNode(true);

      // 移除不用于总结的内容元素
      clonedArticleContent.querySelectorAll(
        'pre, code, blockquote, img, .meta, .discourse-footnote-link, .emoji, ' +
        '.signature, .system-message, .post-links, .hidden'
      ).forEach(el => el.remove());

      let fullTextContent = clonedArticleContent.textContent.trim();
      fullTextContent = fullTextContent.replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n\n').trim();

      if (CONFIG.USE_AI_FOR_SUMMARY && CONFIG.API_KEY) {
        console.log('尝试使用 AI 总结内容...');
        const contentToSummarize = fullTextContent.substring(0, 4000);
        const customPrompt = CONFIG.CUSTOM_SUMMARY_PROMPT || DEFAULT_CONFIG.CUSTOM_SUMMARY_PROMPT;
        const prompt = customPrompt
          .replace('{maxChars}', CONFIG.LOCAL_SUMMARY_MAX_CHARS)
          .replace('{content}', contentToSummarize);

        try {
          articleData.summary = `[AI总结]:` + await callAiAPI(prompt, CONFIG.API_KEY, CONFIG.MODEL_NAME);
          console.log(CONFIG.AI_MODE, CONFIG.MODEL_NAME, '总结:', articleData.summary);
          articleData.summary = articleData.summary.replace(/^(.)\s*(\S+)/, '$1$2').trim();
        } catch (error) {
          console.error('AI 总结失败:', error);
          articleData.summary = fullTextContent.substring(0, CONFIG.LOCAL_SUMMARY_MAX_CHARS) + (fullTextContent.length > CONFIG.LOCAL_SUMMARY_MAX_CHARS ? '...' : '');
        }
      } else {
        articleData.summary = fullTextContent.substring(0, CONFIG.LOCAL_SUMMARY_MAX_CHARS) + (fullTextContent.length > CONFIG.LOCAL_SUMMARY_MAX_CHARS ? '...' : '');
        if (!CONFIG.API_KEY && CONFIG.USE_AI_FOR_SUMMARY) {
          console.warn('未提供 AI Key 或未启用 API 总结，将使用本地简单截取。');
        }
      }
    }

    return articleData;
  }
  // #endregion

  // #region UI 交互
  // ==========================================================

  /**
   * @description 在文章标题旁边创建一个复制按钮并添加到页面中。
   * @param {HTMLElement} titleElement - 文章标题的 <a> 元素。
   * @param {HTMLElement} articleRootElement - 文章内容的根元素。
   */
  function addCopyButtonToArticleTitle(titleElement, articleRootElement) {
    // 可能导致判断不准确 重复添加copy按钮原因未知
    // if (titleElement.nextElementSibling && titleElement.nextElementSibling.classList.contains('article-copy-button')) {
    if (titleElement.parentNode.querySelectorAll('.article-copy-button').length > 0) {
      // console.log('复制按钮已存在，跳过添加。');
      return;
    }

    const copyButton = document.createElement('button');
    copyButton.className = 'copy-button article-copy-button';
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

    titleElement.parentNode.insertBefore(copyButton, titleElement.nextSibling);

    copyButton.addEventListener('click', async (e) => {
      e.stopPropagation();

      if (copyButton.classList.contains('loading')) {
        return;
      }

      copyButton.classList.add('loading');
      copyButton.disabled = true;

      try {
        const articleData = await getArticleData(titleElement, articleRootElement);
        console.log('获取到的文章数据:', articleData);

        let formattedText = CONFIG.ARTICLE_COPY_TEMPLATE.replace(/{{(\w+)}}/g, (match, key) => {
          return articleData[key] !== undefined ? articleData[key] : match;
        });
        formattedText = formattedText.replace(/\n\n+/g, '\n\n').trim();

        copyTextToClipboard({ element: copyButton, text: formattedText });
      } catch (error) {
        handleCopyError({ element: copyButton, error });
      } finally {
        copyButton.classList.remove('loading');
        copyButton.disabled = false;
      }
    });
  }
  // #endregion

  // #region 设置界面
  // ==========================================================

  /**
   * @description 创建设置界面的 HTML 结构。
   * @returns {HTMLDialogElement} 返回创建的 dialog 元素。
   */
  function createSettingsModal() {
    const dialog = document.createElement('dialog');
    dialog.className = 'linuxdo-settings-dialog';

    dialog.innerHTML = `
      <div class="linuxdo-settings-content">
        <div class="linuxdo-settings-header">
          <h2 class="linuxdo-settings-title">LinuxDo 分享助手设置</h2>
          <button class="linuxdo-settings-close" type="button">&times;</button>
        </div>
        <form class="linuxdo-settings-form" method="dialog">
          <div class="linuxdo-settings-field">
            <div class="linuxdo-settings-checkbox-wrapper">
              <input type="checkbox" id="useGeminiApi" class="linuxdo-settings-checkbox" ${CONFIG.USE_AI_FOR_SUMMARY ? 'checked' : ''}>
              <label for="useGeminiApi" class="linuxdo-settings-label" style="color:#7d0000">启用 AI 自动总结</label>
            </div>
            <div class="linuxdo-settings-description">开启后将使用 AI 对文章内容进行智能总结</div>
          </div>

          <div class="linuxdo-settings-field">
            <label for="aiMode" class="linuxdo-settings-label">AI 模式</label>
            <select id="aiMode" class="linuxdo-settings-select linuxdo-settings-input">
              <option value="gemini" ${CONFIG.AI_MODE === 'gemini' ? 'selected' : ''}>Gemini</option>
              <option value="openaiCompatible" ${CONFIG.AI_MODE === 'openaiCompatible' ? 'selected' : ''}>OpenAI Compatible</option>
            </select>
          </div>

          <div class="linuxdo-settings-field">
            <label for="geminiApiKey" class="linuxdo-settings-label">API Key</label>
            <input type="password" id="geminiApiKey" class="linuxdo-settings-input" value="${CONFIG.API_KEY}" placeholder="请输入您的 API Key">
          </div>

          <div class="linuxdo-settings-field">
            <label for="geminiApiBaseUrl" class="linuxdo-settings-label">API地址</label>
            <input type="text" id="geminiApiBaseUrl" class="linuxdo-settings-input" value="${CONFIG.API_BASE_URL}" placeholder="https://generativelanguage.googleapis.com">
            <div class="linuxdo-settings-description">官方key填 https://generativelanguage.googleapis.com</div>
            <div class="linuxdo-settings-description">gpt-load填 http://ip:port/proxy/customPath</div>
            <div class="linuxdo-settings-description">获取Gemini官方key<a href="https://aistudio.google.com/apikey" target="_blank">点击获取</a></div>
            <div class="linuxdo-settings-description">openaiCompatible模式下,地址为全量(一般为baseUrl + /v1/chat/completions)</div>
          </div>

          <div class="linuxdo-settings-field">
            <label for="geminiModel" class="linuxdo-settings-label">AI 模型</label>
            <input type="text" id="geminiModelInput" class="linuxdo-settings-input" value="${CONFIG.MODEL_NAME}" placeholder="输入模型名称">
          </div>

          <div class="linuxdo-settings-field">
            <label for="localSummaryMaxChars" class="linuxdo-settings-label">总结后的最大字符数maxChars</label>
            <input type="number" id="localSummaryMaxChars" class="linuxdo-settings-input" value="${CONFIG.LOCAL_SUMMARY_MAX_CHARS}" placeholder="140" min="1" max="10000" />
            <div class="linuxdo-settings-description">设置总结后粘贴板的最大字符数，范围：1-10000</div>
          </div>

          <div class="linuxdo-settings-field">
            <label for="customPrompt" class="linuxdo-settings-label">自定义总结 Prompt</label>
            <textarea id="customPrompt" class="linuxdo-settings-textarea" placeholder="输入自定义的总结提示词">${CONFIG.CUSTOM_SUMMARY_PROMPT}</textarea>
            <div class="linuxdo-settings-description">{maxChars} 总结后粘贴板的最大字符数(未启用AI总结时则为正文截断字符数)</div>
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
   * @description 为设置界面的所有可交互元素绑定事件监听器。
   * @param {HTMLDialogElement} dialog - 设置界面的 dialog 元素。
   */
  function bindSettingsEvents(dialog) {
    const closeBtn = dialog.querySelector('.linuxdo-settings-close');
    const cancelBtn = dialog.querySelector('#cancelSettings');
    const saveBtn = dialog.querySelector('#saveSettings');
    const modelWrapper = dialog.querySelector('.linuxdo-model-input-wrapper');

    const closeDialog = () => {
      if (typeof dialog.close === 'function') {
        dialog.setAttribute('closing', '');
        setTimeout(() => {
          dialog.close();
          dialog.remove();
        }, 200);
      } else {
        dialog.remove();
        const backdrop = document.querySelector('.dialog-backdrop-fallback');
        if (backdrop) backdrop.remove();
      }
    };

    closeBtn.addEventListener('click', closeDialog);
    cancelBtn.addEventListener('click', closeDialog);

    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      closeDialog();
    });

    saveBtn.addEventListener('click', (e) => {
      e.preventDefault();

      const useGeminiApi = dialog.querySelector('#useGeminiApi').checked;
      const aiMode = dialog.querySelector('#aiMode').value;
      const apiKey = dialog.querySelector('#geminiApiKey').value.trim();
      const apiBaseUrl = dialog.querySelector('#geminiApiBaseUrl').value.trim();
      const localSummaryMaxChars = parseInt(dialog.querySelector('#localSummaryMaxChars').value.trim()) || DEFAULT_CONFIG.LOCAL_SUMMARY_MAX_CHARS;
      const customPrompt = dialog.querySelector('#customPrompt').value.trim();
      const modelValue = dialog.querySelector('#geminiModelInput').value.trim();

      setConfig('USE_AI_FOR_SUMMARY', useGeminiApi);
      setConfig('AI_MODE', aiMode);
      setConfig('API_KEY', apiKey);
      setConfig('API_BASE_URL', apiBaseUrl || DEFAULT_CONFIG.API_BASE_URL);
      setConfig('MODEL_NAME', modelValue || DEFAULT_CONFIG.MODEL_NAME);
      setConfig('LOCAL_SUMMARY_MAX_CHARS', localSummaryMaxChars);
      setConfig('CUSTOM_SUMMARY_PROMPT', customPrompt || DEFAULT_CONFIG.CUSTOM_SUMMARY_PROMPT);

      const originalText = saveBtn.textContent;
      saveBtn.textContent = '已保存 ✓';
      saveBtn.disabled = true;

      setTimeout(() => {
        closeDialog();
      }, 300);
    });
  }

  /**
   * @description 显示设置界面模态框。
   */
  function showSettingsModal() {
    if (window !== window.top) {
      console.log('在 iframe 中，跳过显示设置界面');
      return;
    }

    const existingDialog = document.querySelector('.linuxdo-settings-dialog');
    if (existingDialog) {
      existingDialog.remove();
    }

    const dialog = createSettingsModal();
    document.body.appendChild(dialog);

    bindSettingsEvents(dialog);

    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.style.display = 'block';
      dialog.style.position = 'fixed';
      dialog.style.top = '50%';
      dialog.style.left = '50%';
      dialog.style.transform = 'translate(-50%, -50%)';
      dialog.style.zIndex = '10000';

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
  // #endregion

  // #region 脚本初始化与执行
  // ==========================================================

  /**
   * @description 脚本的主要初始化函数。
   * 负责查找页面上的关键元素，并在找到后调用函数添加复制按钮。
   */
  function initializeScript() {
    if (window !== window.top) {
      console.log("在 iframe 中，跳过脚本初始化");
      return;
    }

    // console.log("油猴脚本已尝试初始化。");

    const titleLinkElement = document.querySelector('h1[data-topic-id] a.fancy-title');
    const articleRootElement = document.querySelector('.cooked');
    const userDataContainer = document.querySelector('.topic-meta-data');
    const categoryBadge = document.querySelector('.topic-category .badge-category__wrapper');
    const tagsElement = document.querySelector('.list-tags');

    if (titleLinkElement && articleRootElement && userDataContainer && categoryBadge) {
      if (titleLinkElement.parentNode && titleLinkElement.parentNode.tagName === 'H1') {
        const parentH1 = titleLinkElement.parentNode;
        if (!parentH1.style.display || !parentH1.style.display.includes('flex')) {
          parentH1.style.display = 'flex';
          parentH1.style.alignItems = 'center';
          parentH1.style.gap = '8px';
          // console.log('已调整 H1 父元素样式为 flex。');
        }
      }

      addCopyButtonToArticleTitle(titleLinkElement, articleRootElement);
    } else {
      console.log('部分所需元素未找到，等待DOM更新:', {
        title: !!titleLinkElement,
        content: !!articleRootElement,
        userData: !!userDataContainer,
        category: !!categoryBadge,
        tags: !!tagsElement
      });
    }
  }

  // 脚本执行入口
  if (window === window.top) {

    // 添加复制按钮函数增加节流
    let initializeScriptThrottleFormGemini = throttleFormGemini(initializeScript, 300);

    // 注入样式
    addStyle(copyBtnStyle);

    // 注册油猴菜单命令
    GM_registerMenuCommand('设置', showSettingsModal);

    // 使用 MutationObserver 监听 DOM 变化，以适应动态加载内容的单页应用 (SPA)
    const observer = new MutationObserver((mutationsList, observerInstance) => {
      initializeScriptThrottleFormGemini();
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // 初始加载时也尝试运行一次
    if (document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', initializeScriptThrottleFormGemini);
    } else {
      initializeScriptThrottleFormGemini();
    }
  } else {
    // console.log("在 iframe 中，跳过脚本功能初始化");
  }
  // #endregion

})();
