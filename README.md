# 快速分享 Linux do 文章

<img width="550" height="300" alt="image" src="https://github.com/user-attachments/assets/b91e3626-9377-4624-b149-28efd5e8ed1b" />

## 点击可获得 ↓

-请不要把互联网上的戾气带来这里！
@Neo(运营反馈)

L 站打击傲慢、阴阳怪气、攻击谩骂，旨在打造和谐社区。请友善交流，遵守规则，违者严惩。

https://linux.do/t/topic/482293

## 可以接入Gemini来总结正文内容
<img width="911" height="398" alt="image" src="https://github.com/user-attachments/assets/7deb9373-b5d0-4596-bff8-9cc5400c9e4b" />

## greasyfork

https://greasyfork.org/zh-CN/scripts/543581

### SFC 应用中遇到的问题分析

`linux.do` 论坛使用 **Discourse**，这是一个基于 Ember.js 的 **单页应用（SPA）**。这意味着页面内容是动态加载和渲染的，而不是一次性从服务器完整加载的。您的脚本在处理这种动态内容时，可能会遇到以下挑战：

1.  **DOM 元素加载时机**:

    - 脚本可能在页面初始加载时（`DOMContentLoaded` 或 `document.readyState` 为 `loading`）运行，但此时文章标题、内容（`.cooked`）或用户数据容器（`.topic-meta-data`）等关键 DOM 元素可能尚未被 Ember.js 框架完全渲染到页面上。
    - 即使使用 `MutationObserver`，如果观察不够精细或回调逻辑处理不当，也可能导致重复添加按钮或数据抓取失败。

2.  **元素选择器问题**:

    - SFC 应用的 DOM 结构可能会比传统网站更复杂或更具动态性。例如，某些元素可能在 Shadow DOM 中（尽管 Discourse 不太常见），或者其类名、ID 会动态生成。
    - 您的 `getUserData` 函数中对 `domElement` 的选择 (`document.querySelector('.topic-meta-data')`) 以及内部元素的查找可能不够鲁棒，尤其是当页面在不同状态下（如刷新、导航到新主题）其结构有微小变化时。
    - `titleLinkElement.querySelector('span').textContent.trim();` 这一行可能存在问题。`a.fancy-title` 通常直接包含文本，而不需要再查询 `span` 子元素。

3.  **重复执行**:

    - 当前的 `MutationObserver` 逻辑可能在 DOM 变化时反复调用 `initializeScript()`，如果不对按钮是否已添加进行充分检查，可能导致页面上出现多个复制按钮。

---

### 解决方案与脚本改进

为了解决这些问题，我们可以对脚本进行以下改进：

1.  **优化 `MutationObserver` 策略**: 让观察器更智能地判断何时执行初始化逻辑，并确保只添加一次按钮。
2.  **增强元素选择器的鲁棒性**: 采用更灵活或更具体的选择器来定位目标元素，同时考虑它们的加载时机。
3.  **清理和规范代码**: 提高可读性和维护性，修复一些小问题。

---

### 主要改进点解释

1.  **`@run-at document-idle`**:

    - 在脚本头部添加了 `@run-at document-idle`。这指示 Tampermonkey 在文档完全加载（包括所有图片、样式表等）并且浏览器处于“空闲”状态时运行脚本。这对于 SPA 应用尤其有用，因为它能确保在框架渲染完大部分内容后再尝试操作 DOM。

2.  **更健壮的 `getUserData` 函数**:

    - 将 `plate` 属性名改为更通用的 `category`，与模板中的 `{{category}}` 对应。
    - 增加了\*\*标签（tags）\*\*的提取逻辑，从 `.topic-tags` 容器中查找所有 `.discourse-tag` 元素并收集为数组。
    - **优化了用户名和用户头衔的选择器**，考虑了 `linux.do`（Discourse）中可能存在的不同 DOM 结构，使其更精确地定位到发帖人信息。
    - 增加了获取不到标签时的**默认值** (`['无标签']`)。

3.  **精确的 `titleLinkElement` 文本获取**:

    - 在 `getArticleData` 中，将 `titleLinkElement.querySelector('span').textContent.trim();` 改为 `titleLinkElement.textContent.trim();`。通常 `a.fancy-title` 元素本身就包含标题文本，不需要再找其内部的 `span`。

4.  **内容总结前的 DOM 清理**:

    - 在 `getArticleData` 中，获取 `fullTextContent` 之前，增加了**克隆 `articleRootElement`** 并**移除不必要的子元素**（如代码块 `pre, code`、引用 `blockquote`、图片 `img`、元数据 `.meta`、签名 `.signature` 等）的步骤。这样可以确保 Gemini API 接收到的文本更干净，总结更准确，避免将不相关的内容纳入总结范围。

5.  **CSS 样式调整**:

    - 修改了 `h1[data-topic-id]` 的 CSS 规则，强制其 `display: flex` 和 `align-items: center`，并增加了 `gap`，这样无论标题多长，复制按钮都能与标题**完美对齐**，并保持适当的间距。

6.  **`MutationObserver` 优化**:

    - `MutationObserver` 的回调函数现在只执行 `initializeScript()`。
    - `initializeScript()` 内部会进行**全面的元素存在性检查**，并且 `addCopyButtonToArticleTitle` 函数会负责**判断按钮是否已存在**，从而防止重复添加。这种模式在 SPA 中非常有效，因为即使 DOM 频繁变化，它也能确保在正确时机一次性地完成任务。

7.  **复制成功/失败的视觉反馈**:

    - 在 `copyTextToClipboard` 和 `handleCopyError` 函数中，增加了 `element.focus()` 和 `element.blur()` 以及 `setTimeout`，利用 CSS 的 `:focus` 伪类来短暂显示“已复制”或“复制失败”的提示，增强用户体验。

---

### 使用方法与调试

1.  **更新脚本**: 在 Tampermonkey 中用新的代码替换旧代码，并保存。
2.  **检查配置**: 在 Tampermonkey 脚本设置中，根据需要调整 `USE_GEMINI_API_FOR_SUMMARY`（是否启用 AI 总结）、`GEMINI_API_KEY`（你的 Gemini API 密钥）和 `LOCAL_SUMMARY_MAX_CHARS`（本地总结最大字符数，现在默认为 150）等配置。
3.  **访问 `linux.do`**: 打开或刷新 `linux.do` 的任何文章页面。
4.  **查看控制台**: 打开浏览器的开发者工具（通常按 `F12`），切换到“控制台”（Console）选项卡。你会看到脚本的日志输出，例如“油猴脚本已尝试初始化。”，以及成功找到元素或获取数据的消息。如果出现错误，也会有详细的错误信息。这些日志对于调试非常有用。

通过这些改进，脚本在 `linux.do` 这样的 SFC 应用中应该能更稳定、更准确地工作。
