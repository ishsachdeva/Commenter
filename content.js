const UI_NOISE_PHRASES = ['Like', 'Comment', 'Repost', 'Send', 'Share', 'Follow', 'AI Comment', 'Add a comment', 'Promoted', 'Sponsored', 'Suggested'];
const BUTTON_ATTR = 'data-ai-comment-button';
const PANEL_ID = 'ai-comment-panel';
let panelState = null;

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
    .ai-comment-panel { position: absolute; z-index: 999999; width: min(92vw, 700px); min-width: 320px; max-width: 700px; max-height: 60vh; overflow: auto; background: #fff; border: 1px solid #d0d0d0; border-radius: 10px; box-shadow: 0 6px 20px rgba(0,0,0,.2); padding: 12px; }
    .ai-comment-panel h4 { margin: 0 0 6px 0; font-size: 13px; }
    .ai-comment-summary { font-size: 12px; margin-bottom: 8px; color: #333; }
    .ai-comment-result-layout { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(280px, 1.6fr); gap: 12px; align-items: start; }
    .ai-comment-summary-column, .ai-comment-comments-column { min-width: 0; }
    .ai-comment-comments-column { display: grid; gap: 6px; }
    .ai-comment-card { border: 1px solid #e5e5e5; border-radius: 8px; padding: 8px; cursor: pointer; font-size: 12px; background: #fff; }
    .ai-comment-card:hover { background: #f7f9fb; }
    .ai-comment-meta { font-size: 11px; color: #666; margin-bottom: 4px; }
    .ai-comment-error { color: #b00020; font-size: 12px; }
    @media (max-width: 700px) {
      .ai-comment-panel { width: min(94vw, 640px); min-width: 0; }
      .ai-comment-result-layout { grid-template-columns: 1fr; }
    }
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


function getScreenPositionPostText(button) {
  if (!(button instanceof HTMLElement)) return '';

  const buttonRect = button.getBoundingClientRect();
  const allCandidates = Array.from(document.querySelectorAll('[data-testid="expandable-text-box"]'));
  console.log(`[AI Comment] total expandable-text-box candidates: ${allCandidates.length}`);

  const valid = [];
  for (const candidate of allCandidates) {
    if (!(candidate instanceof HTMLElement)) continue;
    if (!isVisible(candidate)) continue;

    const candidateRect = candidate.getBoundingClientRect();
    const distance = buttonRect.top - candidateRect.bottom;
    if (!(candidateRect.bottom < buttonRect.top)) continue;
    if (!(distance < 1200)) continue;

    const rawText = (candidate.innerText || '').trim();
    valid.push({ candidate, rawText, distance });
  }

  console.log(`[AI Comment] visible candidates found: ${valid.length}`);
  valid.forEach((entry, index) => {
    console.log(`[AI Comment] candidate ${index} text length: ${entry.rawText.length}`);
    console.log(`[AI Comment] candidate ${index} vertical distance from button: ${Math.round(entry.distance)}`);
  });

  valid.sort((a, b) => a.distance - b.distance);

  const selected = valid[0];
  console.log('[AI Comment] selected candidate text:', selected?.rawText || '');

  let cleaned = cleanLinkedInText(selected?.rawText || '');

  if (cleaned.length < 40) {
    const combinedRaw = valid.slice(0, 3).map((entry) => entry.rawText).join('\n');
    const combinedCleaned = cleanLinkedInText(combinedRaw);
    if (combinedCleaned.length > 40) cleaned = combinedCleaned;
  }

  console.log(`[AI Comment] final cleaned text length: ${cleaned.length}`);
  return cleaned;
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

function closePanel() {
  if (panelState) {
    window.removeEventListener('scroll', panelState.onViewportChange, true);
    window.removeEventListener('resize', panelState.onViewportChange);
    panelState = null;
  }
  document.getElementById(PANEL_ID)?.remove();
}

function getPanelContainer(button) {
  return button.closest('form, .comments-comment-box, .comments-comment-box__form-container, .comments-comment-item, article, [role="article"], section, div') || button.parentElement || document.body;
}

function positionPanel() {
  const panel = document.getElementById(PANEL_ID);
  if (!panel || !panelState) return;
  const { button, container } = panelState;
  if (!button.isConnected || !container.isConnected) {
    closePanel();
    return;
  }

  const buttonRect = button.getBoundingClientRect();
  const inViewport = buttonRect.bottom >= 0 && buttonRect.top <= window.innerHeight && buttonRect.right >= 0 && buttonRect.left <= window.innerWidth;
  if (!inViewport) {
    closePanel();
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const top = Math.max(0, buttonRect.bottom - containerRect.top + 8);

  const panelWidth = panel.offsetWidth || Math.min(700, Math.max(320, window.innerWidth - 16));
  const maxLeftInContainer = Math.max(0, container.clientWidth - panelWidth);
  const desiredLeft = buttonRect.left - containerRect.left;
  const minLeftFromViewport = 8 - containerRect.left;
  const maxLeftFromViewport = window.innerWidth - panelWidth - 8 - containerRect.left;
  const left = Math.max(0, Math.min(maxLeftInContainer, Math.max(minLeftFromViewport, Math.min(maxLeftFromViewport, desiredLeft))));

  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;
}

function showPanelNear(button, html) {
  const container = getPanelContainer(button);
  const sameAnchor = panelState?.button === button && panelState?.container === container;
  if (!sameAnchor) closePanel();
  else document.getElementById(PANEL_ID)?.remove();

  const containerStyle = window.getComputedStyle(container);
  if (containerStyle.position === 'static') container.style.position = 'relative';

  const panel = document.createElement('section');
  panel.className = 'ai-comment-panel';
  panel.id = PANEL_ID;
  panel.innerHTML = html;
  container.appendChild(panel);

  const onViewportChange = () => positionPanel();
  panelState = { button, container, onViewportChange };
  window.addEventListener('scroll', onViewportChange, true);
  window.addEventListener('resize', onViewportChange);
  positionPanel();
}

async function onAiCommentClick(button, editor) {
  showPanelNear(button, '<h4>AI Comment</h4><div class="ai-comment-summary">Generating suggestions…</div>');

  let postText = getScreenPositionPostText(button);
  if (!postText) {
    const postContainer = findNearestPostContainer(editor) || findNearestPostContainer(button);
    postText = extractPostText(postContainer);
  }

  showPanelNear(
    button,
    `<h4>AI Comment</h4><div class="ai-comment-summary">Extracted post text preview:</div><pre style="white-space: pre-wrap; font-size: 11px; max-height: 160px; overflow: auto; background: #f7f9fb; padding: 8px; border-radius: 6px;">${escapeHtml(postText || '(empty)')}</pre><div class="ai-comment-summary">Generating suggestions…</div>`
  );

  if (!postText || postText.length < 40) {
    showPanelNear(button, '<h4>AI Comment</h4><div class="ai-comment-error">Not enough post text found near this comment area.</div>');
    return;
  }

  try {
    const result = await chrome.runtime.sendMessage({ action: 'GENERATE_COMMENTS', postText });
    if (!result?.ok) throw new Error(result?.error || 'Generation failed');
    const parsed = result.data;

    const cards = parsed.comments
      .map((c, idx) => `<div class="ai-comment-card" data-idx="${idx}"><div class="ai-comment-meta">${escapeHtml(c.style)}</div>${escapeHtml(c.text)}</div>`)
      .join('');

    showPanelNear(
      button,
      `<h4>AI Comment</h4>
      <div class="ai-comment-result-layout">
        <div class="ai-comment-summary-column">
          <h4>Summary</h4>
          <div class="ai-comment-summary">${escapeHtml(parsed.summary)}</div>
        </div>
        <div class="ai-comment-comments-column">
          <h4>Suggested Comments</h4>
          ${cards}
        </div>
      </div>`
    );
    const panel = document.getElementById(PANEL_ID);
    panel?.addEventListener('click', (event) => {
      const item = event.target instanceof Element ? event.target.closest('.ai-comment-card') : null;
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
