const MODEL_NAME = 'gpt-4o-mini';
const UI_NOISE_PHRASES = ['Like', 'Comment', 'Repost', 'Send', 'Share', 'Follow', 'AI Comment', 'Add a comment', 'Promoted', 'Sponsored'];
const BUTTON_ATTR = 'data-ai-comment-button';
const PANEL_ID = 'ai-comment-panel';

function isVisible(element) {
  if (!(element instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function injectStyles() {
  if (document.getElementById('ai-comment-inline-style')) return;
  const style = document.createElement('style');
  style.id = 'ai-comment-inline-style';
  style.textContent = `
    .ai-comment-btn { margin-left: 8px; border: 1px solid #0a66c2; background: #fff; color: #0a66c2; border-radius: 16px; padding: 4px 10px; font-size: 12px; cursor: pointer; }
    .ai-comment-btn:hover { background: #eef5fc; }
    .ai-comment-panel { position: fixed; z-index: 999999; width: 320px; max-height: 60vh; overflow: auto; background: #fff; border: 1px solid #d0d0d0; border-radius: 10px; box-shadow: 0 6px 20px rgba(0,0,0,.2); padding: 10px; }
    .ai-comment-panel h4 { margin: 0 0 6px 0; font-size: 13px; }
    .ai-comment-summary { font-size: 12px; margin-bottom: 8px; color: #333; }
    .ai-comment-item { border: 1px solid #e5e5e5; border-radius: 8px; padding: 8px; margin: 6px 0; cursor: pointer; font-size: 12px; }
    .ai-comment-item:hover { background: #f7f9fb; }
    .ai-comment-meta { font-size: 11px; color: #666; margin-bottom: 4px; }
    .ai-comment-error { color: #b00020; font-size: 12px; }
  `;
  document.head.appendChild(style);
}

function cleanLinkedInText(text) {
  if (!text) return '';

  const lines = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((line) => !UI_NOISE_PHRASES.includes(line))
    .filter((line) => !/^(like|comment|repost|send|follow|share|ai comment|add a comment)$/i.test(line));

  const deduped = [];
  for (const line of lines) {
    if (deduped[deduped.length - 1] !== line) deduped.push(line);
  }

  return deduped.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function hasMeaningfulSentenceLikeText(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const sentenceCount = text.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 4).length;
  return words.length >= 25 && sentenceCount >= 2;
}

function findNearestPostContainer(startElement) {
  let node = startElement;

  for (let level = 0; level < 10 && node; level += 1) {
    const visible = isVisible(node);
    const rawText = visible ? (node.innerText || '') : '';
    const cleanedText = cleanLinkedInText(rawText);
    console.log(`[AI Comment] Parent level ${level}`, node);
    console.log(`[AI Comment] Parent level ${level} cleaned text length: ${cleanedText.length}`);

    if (visible && cleanedText.length > 150 && hasMeaningfulSentenceLikeText(cleanedText)) {
      console.log(`[AI Comment] Selected post container at level ${level}`, node);
      return node;
    }

    node = node.parentElement;
  }

  return null;
}

function extractFromExpandableTextBox(container) {
  if (!container) return '';
  const nodes = Array.from(container.querySelectorAll('[data-testid="expandable-text-box"]'))
    .filter((node) => node instanceof HTMLElement && isVisible(node));
  const rawText = nodes.map((node) => node.innerText || '').join('\n');
  const cleaned = cleanLinkedInText(rawText);
  console.log(`[AI Comment] expandable-text-box count: ${nodes.length}`);
  console.log('[AI Comment] expandable-text-box extracted text:', cleaned);
  console.log(`[AI Comment] expandable-text-box cleaned length: ${cleaned.length}`);
  return cleaned;
}

function extractVisibleText(container) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !isVisible(parent)) return NodeFilter.FILTER_REJECT;
      const value = node.nodeValue?.trim();
      if (!value) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const chunks = [];
  while (walker.nextNode()) {
    chunks.push(walker.currentNode.nodeValue.trim());
  }

  return cleanLinkedInText(chunks.join('\n'));
}

function extractPostText(candidateContainer) {
  const primary = extractFromExpandableTextBox(candidateContainer);
  if (primary) {
    console.log(`[AI Comment] final cleaned length: ${primary.length}`);
    return primary;
  }
  const fallback = candidateContainer ? extractVisibleText(candidateContainer) : '';
  console.log('[AI Comment] fallback extracted text:', fallback);
  console.log(`[AI Comment] final cleaned length: ${fallback.length}`);
  return fallback;
}

function findNearestEditor(sourceElement) {
  const base = sourceElement.closest('form, .comments-comment-box, .comments-comment-item, [role="article"], article') || sourceElement.parentElement;
  if (!base) return null;
  const editors = base.querySelectorAll('[contenteditable="true"], div[role="textbox"]');
  for (const editor of editors) {
    if (editor instanceof HTMLElement && isVisible(editor)) return editor;
  }
  return null;
}

function setEditorText(editor, text) {
  editor.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  editor.dispatchEvent(new Event('change', { bubbles: true }));
}

function safelyParseAiJson(rawText) {
  const cleaned = (rawText || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed?.summary !== 'string' || !Array.isArray(parsed?.comments) || parsed.comments.length !== 4) return null;
    if (!parsed.comments.every((c) => typeof c?.style === 'string' && typeof c?.text === 'string')) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function getStoredApiKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['aiApiKey'], (result) => resolve(result?.aiApiKey?.trim() || ''));
  });
}

async function generateSuggestions(postText, apiKey) {
  const prompt = `You are helping write LinkedIn comments. Respond with strict JSON only, with no markdown and no extra keys:\n{\n  "summary": "...",\n  "comments": [\n    {"style": "Insightful", "text": "..."},\n    {"style": "Supportive", "text": "..."},\n    {"style": "Question-based", "text": "..."},\n    {"style": "Contrarian", "text": "..."}\n  ]\n}\n\nPost text:\n${postText}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL_NAME,
      temperature: 0.7,
      messages: [
        { role: 'system', content: 'Return only valid JSON that matches the required schema exactly.' },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!response.ok) throw new Error(`AI API request failed with status ${response.status}`);
  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '';
}

function closePanel() {
  document.getElementById(PANEL_ID)?.remove();
}

function showPanelNear(button, html) {
  closePanel();
  const panel = document.createElement('section');
  panel.className = 'ai-comment-panel';
  panel.id = PANEL_ID;
  panel.innerHTML = html;
  document.body.appendChild(panel);
  const rect = button.getBoundingClientRect();
  panel.style.top = `${Math.min(window.innerHeight - 20, rect.bottom + 8)}px`;
  panel.style.left = `${Math.max(8, Math.min(window.innerWidth - panel.offsetWidth - 8, rect.left))}px`;
}

async function onAiCommentClick(button, editor) {
  showPanelNear(button, '<h4>AI Comment</h4><div class="ai-comment-summary">Generating suggestions…</div>');

  const postContainer = findNearestPostContainer(editor) || findNearestPostContainer(button);
  const postText = extractPostText(postContainer);

  showPanelNear(
    button,
    `<h4>AI Comment</h4><div class="ai-comment-summary">Extracted post text preview:</div><pre style="white-space: pre-wrap; font-size: 11px; max-height: 160px; overflow: auto; background: #f7f9fb; padding: 8px; border-radius: 6px;">${escapeHtml(postText || '(empty)')}</pre><div class="ai-comment-summary">Generating suggestions…</div>`
  );

  if (!postText || postText.length < 40) {
    showPanelNear(button, '<h4>AI Comment</h4><div class="ai-comment-error">Not enough post text found near this comment area.</div>');
    return;
  }

  const apiKey = await getStoredApiKey();
  if (!apiKey) {
    showPanelNear(button, '<h4>AI Comment</h4><div class="ai-comment-error">Missing API key. Set it in Options.</div>');
    return;
  }

  try {
    const aiText = await generateSuggestions(postText, apiKey);
    const parsed = safelyParseAiJson(aiText);
    if (!parsed) throw new Error('Invalid AI JSON');

    const cards = parsed.comments
      .map((c, idx) => `<div class="ai-comment-item" data-idx="${idx}"><div class="ai-comment-meta">${escapeHtml(c.style)}</div>${escapeHtml(c.text)}</div>`)
      .join('');

    showPanelNear(button, `<h4>AI Comment</h4><div class="ai-comment-summary">${escapeHtml(parsed.summary)}</div>${cards}`);
    const panel = document.getElementById(PANEL_ID);
    panel?.addEventListener('click', (event) => {
      const item = event.target instanceof Element ? event.target.closest('.ai-comment-item') : null;
      if (!item) return;
      const idx = Number(item.getAttribute('data-idx'));
      const targetEditor = findNearestEditor(button) || editor;
      const text = parsed.comments[idx]?.text;
      if (targetEditor && text) setEditorText(targetEditor, text);
    });
  } catch (error) {
    showPanelNear(button, `<h4>AI Comment</h4><div class="ai-comment-error">${escapeHtml(error instanceof Error ? error.message : 'Generation failed')}</div>`);
  }
}

function insertAiButtonForEditor(editor) {
  if (!(editor instanceof HTMLElement) || !isVisible(editor)) return;
  if (editor.dataset.aiCommentBound === '1') return;

  const anchor = editor.closest('.comments-comment-box__form-container, form, .comments-comment-box, .feed-shared-social-action-bar') || editor.parentElement;
  if (!anchor || anchor.querySelector(`[${BUTTON_ATTR}="1"]`)) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ai-comment-btn';
  button.textContent = 'AI Comment';
  button.setAttribute(BUTTON_ATTR, '1');
  button.addEventListener('click', () => onAiCommentClick(button, editor));

  anchor.appendChild(button);
  editor.dataset.aiCommentBound = '1';
}

function scanAndInject() {
  const editors = document.querySelectorAll('[contenteditable="true"], div[role="textbox"]');
  editors.forEach((editor) => {
    const text = (editor.getAttribute('aria-label') || '') + (editor.getAttribute('data-placeholder') || '');
    const looksLikeComment = /comment|reply/i.test(text) || !!editor.closest('[aria-label*="Comment" i], [class*="comment" i], form');
    if (looksLikeComment) insertAiButtonForEditor(editor);
  });

  const commentButtons = Array.from(document.querySelectorAll('button, [role="button"]')).filter((el) => /comment/i.test(el.textContent || ''));
  commentButtons.forEach((btn) => {
    const container = btn.closest('article, [role="article"], section, div');
    if (!container) return;
    const editor = container.querySelector('[contenteditable="true"], div[role="textbox"]');
    if (editor) insertAiButtonForEditor(editor);
  });
}

injectStyles();
scanAndInject();
const observer = new MutationObserver(() => scanAndInject());
observer.observe(document.body, { childList: true, subtree: true });

document.addEventListener('click', (event) => {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;
  const target = event.target;
  if (target instanceof Node && !panel.contains(target) && !(target instanceof Element && target.matches(`.ai-comment-btn,[${BUTTON_ATTR}]`))) closePanel();
});
