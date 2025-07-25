// ==UserScript==
// @name          获取论坛文章数据与复制
// @namespace     http://tampermonkey.net/
// @version       0.2
// @description   从论坛页面获取文章的板块、标题、链接、标签和内容总结，并在标题旁添加复制按钮。
// @author        Loveyless
// @match         *://*.linux.do/*
// @grant         GM_getValue
// @grant         GM_setValue
// @grant         GM_xmlhttpRequest
// @grant         GM_addStyle
// @run-at        document-idle // 更可靠的运行时间，等待DOM和资源加载完成且浏览器空闲
// ==/UserScript==

(function () {
  'use strict';

  // ==========================================================
  // 配置项
  // ==========================================================
  const CONFIG = {
    // 是否启用 Gemini API 进行内容总结
    USE_GEMINI_API_FOR_SUMMARY: GM_getValue('USE_GEMINI_API_FOR_SUMMARY', false),
    // Gemini API Key，如果 USE_GEMINI_API_FOR_SUMMARY 为 true，则需要填写此项 获取:https://aistudio.google.com/apikey
    GEMINI_API_KEY: GM_getValue('GEMINI_API_KEY', ''),
    // Gemini 模型名称，例如 'gemini-pro' 或 'gemini-1.5-flash' 参见:https://ai.google.dev/gemini-api/docs/models?hl=zh-cn
    GEMINI_MODEL: GM_getValue('GEMINI_MODEL', 'gemini-1.5-flash'),
    // 本地内容总结的最大字符数
    LOCAL_SUMMARY_MAX_CHARS: GM_getValue('LOCAL_SUMMARY_MAX_CHARS', 80), // 调整为更合理的字符数，并允许用户配置

    // 文章复制模板
    ARTICLE_COPY_TEMPLATE: GM_getValue('ARTICLE_COPY_TEMPLATE', [
      `-{{title}}`,
      `@{{username}}({{category}})`, // 增加作者信息
      ``,
      `{{summary}}`,
      ``,
      `{{link}}`,
    ].join('\n'))
  };

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
        const prompt = `你是一个信息获取专家，可以精准的总结文章的精华内容和重点，请对以下文章内容进行归纳总结，回复不要有对我的问候语，或者《你好这是我的总结》等类似废话，直接返回你的总结，长度不超过${CONFIG.LOCAL_SUMMARY_MAX_CHARS}个字符（或尽可能短，保持中文语义完整）：\n\n${fullTextContent.substring(0, 4000)}`;
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

      try {
        // 获取文章数据
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
      }
    });
  }

  // ==========================================================
  // 脚本执行入口
  // ==========================================================
  function initializeScript() {
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

})();


