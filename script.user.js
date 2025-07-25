// ==UserScript==
// @name         获取论坛文章数据与复制
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  从论坛页面获取文章的板块、标题、链接、标签和内容总结，并在标题旁添加复制按钮。
// @author       Loveyless
// @match        *://*.linux.do/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// ==/UserScript==

(function () {
  'use strict';

  // ==========================================================
  // 配置项
  // ==========================================================
  const CONFIG = {
    // 是否启用 Gemini API 进行内容总结
    // 设置为 true 会尝试调用 Gemini API，否则只进行本地文本截取
    USE_GEMINI_API_FOR_SUMMARY: GM_getValue('USE_GEMINI_API_FOR_SUMMARY', false),
    // Gemini API Key，如果 USE_GEMINI_API_FOR_SUMMARY 为 true，则需要填写此项
    GEMINI_API_KEY: GM_getValue('GEMINI_API_KEY', ''),
    // Gemini 模型名称，例如 'gemini-pro' 或 'gemini-1.5-flash'
    GEMINI_MODEL: GM_getValue('GEMINI_MODEL', 'gemini-1.5-flash'),
    // 本地内容总结的最大字符数
    LOCAL_SUMMARY_MAX_CHARS: 50, // 调整为50个字符，20个太短了

    // 文章复制模板
    ARTICLE_COPY_TEMPLATE: GM_getValue('ARTICLE_COPY_TEMPLATE', [
      `标题: {{title}}`,
      `链接: {{link}}`,
      `板块: {{category}}`,
      `标签: {{tags}}`,
      `总结: {{summary}}`
    ].join('\n'))
  };

  // 用户可以在 Tampermonkey 设置中配置这些值
  // 例如，在 Tampermonkey 的仪表板中，找到这个脚本，点击“设置”，然后可以在“值”或“Storage”部分修改。
  // 如果用户想启用API总结：
  // GM_setValue('USE_GEMINI_API_FOR_SUMMARY', true);
  // GM_setValue('GEMINI_API_KEY', 'YOUR_GEMINI_API_KEY_HERE');
  // GM_setValue('GEMINI_MODEL', 'gemini-1.5-flash');
  // GM_setValue('ARTICLE_COPY_TEMPLATE', '自定义模板字符串');

  // ==========================================================
  // 全局变量
  // ==========================================================
  let titleLinkElement; // 文章标题元素

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
        /* --tooltip-transition-duration: 0.3s; */
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
        display: inline-flex; /* 保持在行内，并允许内部元素居中 */
        align-items: center; /* 垂直居中 */
        justify-content: center; /* 水平居中 */
        flex-shrink: 0; /* 防止被挤压 */
        margin-left: 8px; /* 与前面的元素保持距离 */
    }

    /* 调整 .fancy-title 的间距，确保按钮有空间 */
    .fancy-title + .copy-button {
        margin-left: 8px;
    }
    
    /* 适配标题的父元素，让按钮能紧随标题 */
    h1[data-topic-id] .fancy-title {
        display: inline-block; /* 确保标题本身可以和按钮同行 */
        vertical-align: middle; /* 垂直对齐 */
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
        z-index: 1000; /* 确保 tooltip 在其他内容之上 */
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
  // 辅助函数 (用于API调用)
  // ==========================================================
  async function callGeminiAPI(prompt, apiKey, model = 'gemini-1.5-flash') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const headers = {
      'Content-Type': 'application/json'
    };
    const body = JSON.stringify({
      contents: [{
        parts: [{
          text: prompt
        }]
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
            if (data.candidates && data.candidates.length > 0) {
              resolve(data.candidates[0].content.parts[0].text);
            } else if (data.error) {
              reject(new Error(`Gemini API Error: ${data.error.message}`));
            } else {
              reject(new Error('Gemini API returned an unexpected response.'));
            }
          } catch (e) {
            reject(new Error('Failed to parse Gemini API response: ' + e.message));
          }
        },
        onerror: function (error) {
          reject(new Error('GM_xmlhttpRequest failed: ' + error.statusText || error.responseText));
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
    }).catch(function (error) {
      handleCopyError({ element, error });
    });
  }

  // ==========================================================
  // 主要数据获取函数
  // ==========================================================
  /**
   * 从文章的DOM元素中提取数据，包括板块、标题、链接、标签和内容总结。
   * @param {Element} articleRootElement 文章的根DOM元素，例如整个帖子的容器。
   * @returns {Promise<Object>} 包含文章数据的Promise。
   */
  async function getArticleData(titleElement, articleRootElement) {

    getUserData(); // 获取用户数据（如果需要）

    const articleData = {
      ...getUserData(), // 获取用户数据并合并到文章数据中
      title: '',
      link: '',
      summary: '',
    };

    if (titleElement) {
      let titleText = titleElement.querySelector('span').textContent.trim();
      let titleLink = titleElement.href || titleElement.getAttribute('href') || '';
      articleData.title = titleText;
      articleData.link = titleLink;
    }

    // 获取内容并进行总结
    if (articleRootElement) {
      let fullTextContent = articleRootElement.textContent.trim().replace(/\s*\n\s*/g, '\n').replace(/\n{2,}/g, '\n\n');

      if (CONFIG.USE_GEMINI_API_FOR_SUMMARY && CONFIG.GEMINI_API_KEY) {
        console.log('尝试使用 Gemini API 总结内容...');
        const prompt = `请对以下文章内容进行简要归纳总结，长度不超过${CONFIG.LOCAL_SUMMARY_MAX_CHARS}个字符（或尽可能短，保持中文语义完整）：\n\n${fullTextContent.substring(0, 2000)}`; // 截取前2000字符发送给API，避免过长
        try {
          articleData.summary = await callGeminiAPI(prompt, CONFIG.GEMINI_API_KEY, CONFIG.GEMINI_MODEL);
        } catch (error) {
          console.error('Gemini API 总结失败:', error);
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
   * 从文章的DOM元素中提取用户数据，包括用户名、用户头衔、用户状态表情和用户状态消息。
   * @returns {Object} 包含用户数据的对象。
   * @property {string} username - 用户名。
   * @property {string} userTitle - 用户头衔。
   * @property {string} userStatusEmoji - 用户状态表情。
   * @property {string} userStatusMessage - 用户状态消息。
   */
  function getUserData() {
    let domElement = document.querySelector('.topic-meta-data'); // 根据实际页面结构调整选择器

    const userData = {
      username: '',
      userTitle: '',
      plate: ''
    };

    const plateElement = document.querySelector('.badge-category__name');
    if (plateElement) {
      userData.plate = plateElement.textContent.trim();
    }

    const usernameElement = domElement.querySelector('.names .first.full-name a');
    if (usernameElement) {
      userData.username = usernameElement.textContent.trim();
    }

    const userTitleElement = domElement.querySelector('.names .user-title');
    if (userTitleElement) {
      userData.userTitle = userTitleElement.textContent.trim();
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
    // 检查是否已经添加了复制按钮
    if (titleElement.nextElementSibling && titleElement.nextElementSibling.classList.contains('copy-button') && titleElement.nextElementSibling.classList.contains('article-copy-button')) {
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

      try {
        // 获取文章数据
        const articleData = await getArticleData(titleElement, articleRootElement);
        console.log('获取到的文章数据:', articleData);

        // 根据模板格式化文本
        let formattedText = CONFIG.ARTICLE_COPY_TEMPLATE.replace(/{{(\w+)}}/g, (match, key) => {
          return articleData[key] !== undefined ? articleData[key] : match;
        });
        // 清理多余空行
        // formattedText = formattedText.replaceAll(/\n\n\n/gi, '\n').replaceAll(/\n\n$/, '\n').trim();

        copyTextToClipboard({ element: copyButton, text: formattedText });
      } catch (error) {
        handleCopyError({ element: copyButton, error });
      }
    });
  }

  // ==========================================================
  // 脚本执行入口
  // ==========================================================
  function initializeScript() {
    console.log("油猴脚本已加载。");

    // 找到文章标题元素
    titleLinkElement = document.querySelector('h1[data-topic-id] a.fancy-title') || titleLinkElement;

    // 设置元素样式保证图标居中
    titleLinkElement.parentNode.style.display = 'flex';
    titleLinkElement.parentNode.style.alignItems = 'center'; // 确保标题和按钮在同一行
    console.log('找到文章标题元素:', titleLinkElement);

    // 找到包含文章所有信息的根元素
    // Discourse 论坛中，通常是 h1.fancy-title 所在的父级 h1 标签，或者其更上层的 .title-wrapper 甚至是整个帖子容器
    // 这里我们找 .title-wrapper 作为文章信息的根元素，因为它包含了标题和分类。
    // 对于内容，则单独查找 .cooked 元素。
    const articleRootElement = document.querySelector('.cooked'); // 整个帖子内容的主容器
    console.log('整个帖子内容的主容器:', articleRootElement);

    if (titleLinkElement && articleRootElement) {

      addCopyButtonToArticleTitle(titleLinkElement, articleRootElement);

      // 也可以在这里立即获取文章数据并打印到控制台 (调试用)
      getArticleData(articleRootElement).then(data => {
        console.log('获取到的文章数据:', data);
      }).catch(error => {
        console.error('获取文章数据失败:', error);
      });

    } else {
      console.warn('未找到文章标题或内容根元素，无法添加复制按钮或提取数据。');
    }
  }

  // 使用 MutationObserver 监听 DOM 变化，确保在内容动态加载时也能添加按钮
  const observer = new MutationObserver((mutations) => {
    // 检查是否有新的标题元素被添加，或者现有元素的子节点变化（例如标题被动态加载）
    const titleLinkElement = document.querySelector('h1[data-topic-id] a.fancy-title');
    const articleRootElement = document.querySelector('.topic-container .topic-body');
    const plateElement = document.querySelector('.badge-category__name');

    if (titleLinkElement && articleRootElement && plateElement) {
      // 检查按钮是否已存在，避免重复添加
      if (!(titleLinkElement.nextElementSibling && titleLinkElement.nextElementSibling.classList.contains('article-copy-button'))) {
        initializeScript(); // 重新运行初始化逻辑来添加按钮
      }
    }
  });

  // 观察整个文档的主体
  observer.observe(document.body, { childList: true, subtree: true });

  // 初始加载时也尝试运行
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initializeScript);
  } else {
    initializeScript();
  }

})();