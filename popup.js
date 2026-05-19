const generateButton = document.getElementById('generateBtn');
const summaryElement = document.getElementById('summary');
const suggestedCommentsElement = document.getElementById('suggestedComments');
const errorPanel = document.getElementById('errorPanel');
const errorMessageElement = document.getElementById('errorMessage');
const commentStatusElement = document.getElementById('commentStatus');

const MODEL_NAME = 'gpt-4o-mini';
const MIN_POST_TEXT_LENGTH = 80;

const ERROR_MESSAGES = {
  NOT_ON_LINKEDIN: 'Open linkedin.com and try again. This tool only works on LinkedIn pages.',
  NO_VISIBLE_POST_FOUND: 'No visible LinkedIn post was found. Scroll so a post is clearly visible, then retry.',
  POST_TEXT_TOO_SHORT:
    'The visible post text is too short to generate useful comments. Open a longer post and try again.',
  API_KEY_MISSING: 'Missing API key. Add it in the extension Options page, then try again.',
  AI_INVALID_JSON:
    'The AI response could not be read. Please retry. If it keeps happening, lower post complexity and try again.',
  COMMENT_BOX_NOT_FOUND:
    'Could not find the LinkedIn comment box for the selected post. Open comments manually and retry.',
  LINKEDIN_DOM_CHANGED:
    'LinkedIn page structure looks different than expected. Refresh LinkedIn and try again.',
  UNKNOWN: 'Something went wrong. Please try again.'
};

const clearError = () => {
  if (!errorPanel || !errorMessageElement) {
    return;
  }

  errorPanel.hidden = true;
  errorMessageElement.textContent = '';
};

const showError = (errorCode) => {
  if (!errorPanel || !errorMessageElement) {
    return;
  }

  const message = ERROR_MESSAGES[errorCode] || ERROR_MESSAGES.UNKNOWN;
  errorPanel.hidden = false;
  errorMessageElement.textContent = message;
};

const setSummaryMessage = (message, isError = false) => {
  if (!summaryElement) {
    return;
  }

  summaryElement.textContent = message;
  summaryElement.classList.toggle('error', isError);
};

const setCommentsMessage = (message, isError = false) => {
  if (!suggestedCommentsElement) {
    return;
  }

  suggestedCommentsElement.textContent = message;
  suggestedCommentsElement.classList.toggle('error', isError);
};

const setCommentStatus = (message, isError = false) => {
  if (!commentStatusElement) {
    return;
  }

  commentStatusElement.textContent = message;
  commentStatusElement.classList.toggle('error', isError);
};

const escapeHtml = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const mapContentScriptErrorToCode = (errorText = '') => {
  const value = errorText.toLowerCase();

  if (value.includes('no visible post')) {
    return 'NO_VISIBLE_POST_FOUND';
  }

  if (value.includes('no visible post text')) {
    return 'NO_VISIBLE_POST_FOUND';
  }

  if (value.includes('comment editor not found') || value.includes('comment box not found')) {
    return 'COMMENT_BOX_NOT_FOUND';
  }

  if (value.includes('dom changed') || value.includes('selectors matched but no text')) {
    return 'LINKEDIN_DOM_CHANGED';
  }

  return 'UNKNOWN';
};

const getVisiblePostText = async () => {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!activeTab?.id) {
    throw new Error('UNKNOWN');
  }

  if (!activeTab.url || !activeTab.url.includes('linkedin.com')) {
    throw new Error('NOT_ON_LINKEDIN');
  }

  try {
    return await chrome.tabs.sendMessage(activeTab.id, { action: 'GET_VISIBLE_POST_TEXT' });
  } catch {
    throw new Error('LINKEDIN_DOM_CHANGED');
  }
};

const getActiveTabId = async () => {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!activeTab?.id) {
    throw new Error('UNKNOWN');
  }

  return activeTab.id;
};

const insertCommentIntoPage = async (commentText) => {
  const tabId = await getActiveTabId();

  try {
    return await chrome.tabs.sendMessage(tabId, {
      action: 'INSERT_COMMENT',
      comment: commentText
    });
  } catch {
    throw new Error('LINKEDIN_DOM_CHANGED');
  }
};

const getStoredApiKey = () =>
  new Promise((resolve) => {
    chrome.storage.local.get(['aiApiKey'], (result) => {
      resolve(result?.aiApiKey?.trim() || '');
    });
  });

const safelyParseAiJson = (rawText) => {
  if (!rawText) {
    return null;
  }

  const cleanedText = rawText
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    const parsed = JSON.parse(cleanedText);

    if (
      typeof parsed?.summary !== 'string' ||
      !Array.isArray(parsed?.comments) ||
      parsed.comments.length !== 4
    ) {
      return null;
    }

    const hasValidComments = parsed.comments.every(
      (comment) => typeof comment?.style === 'string' && typeof comment?.text === 'string'
    );

    return hasValidComments ? parsed : null;
  } catch {
    return null;
  }
};

const generateSuggestions = async (postText, apiKey) => {
  const prompt = `You are helping write LinkedIn comments. Respond with strict JSON only, with no markdown and no extra keys:\n{\n  "summary": "...",\n  "comments": [\n    {"style": "Insightful", "text": "..."},\n    {"style": "Supportive", "text": "..."},\n    {"style": "Question-based", "text": "..."},\n    {"style": "Contrarian", "text": "..."}\n  ]\n}\n\nPost text:\n${postText}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      temperature: 0.7,
      messages: [
        {
          role: 'system',
          content: 'Return only valid JSON that matches the required schema exactly.'
        },
        {
          role: 'user',
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`AI API request failed with status ${response.status}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '';
};

const renderSuggestions = (result) => {
  setSummaryMessage(result.summary, false);

  const cardsHtml = result.comments
    .map((comment) => {
      const style = escapeHtml(comment.style);
      const text = escapeHtml(comment.text);
      return `<article class="comment-card" data-comment="${text}"><h3>${style}</h3><p>${text}</p></article>`;
    })
    .join('');

  suggestedCommentsElement.innerHTML = cardsHtml;
  suggestedCommentsElement.classList.remove('placeholder', 'error');
  setCommentStatus('Click a comment card to insert it into LinkedIn.', false);
};

if (suggestedCommentsElement) {
  suggestedCommentsElement.addEventListener('click', async (event) => {
    const card = event.target instanceof Element ? event.target.closest('.comment-card') : null;

    if (!card) {
      return;
    }

    const commentText = card.getAttribute('data-comment')?.trim();

    if (!commentText) {
      showError('UNKNOWN');
      setCommentStatus('Selected comment is empty.', true);
      return;
    }

    try {
      const response = await insertCommentIntoPage(commentText);

      if (!response?.success) {
        showError(mapContentScriptErrorToCode(response?.error));
        setCommentStatus('Could not insert comment into LinkedIn.', true);
        return;
      }

      clearError();
      setCommentStatus('Comment inserted into LinkedIn editor.', false);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'UNKNOWN');
      setCommentStatus('Could not insert comment into LinkedIn.', true);
    }
  });
}

if (generateButton) {
  generateButton.addEventListener('click', async () => {
    generateButton.disabled = true;
    generateButton.textContent = 'Loading...';
    clearError();
    setSummaryMessage('Looking for the visible LinkedIn post...');
    setCommentsMessage('Preparing suggestions...');
    setCommentStatus('');

    try {
      const response = await getVisiblePostText();
      const postText = response?.postText?.trim();

      if (!response?.success && response?.error) {
        const code = mapContentScriptErrorToCode(response.error);
        showError(code);
        setSummaryMessage('Could not read the current post.', true);
        setCommentsMessage('No comments generated.', true);
        setCommentStatus('');
        return;
      }

      if (!postText) {
        showError('NO_VISIBLE_POST_FOUND');
        setSummaryMessage('No visible post found on this page.', true);
        setCommentsMessage('No comments generated.', true);
        setCommentStatus('');
        return;
      }

      if (postText.length < MIN_POST_TEXT_LENGTH) {
        showError('POST_TEXT_TOO_SHORT');
        setSummaryMessage('Visible post text is too short.', true);
        setCommentsMessage('No comments generated.', true);
        setCommentStatus('');
        return;
      }

      const apiKey = await getStoredApiKey();

      if (!apiKey) {
        showError('API_KEY_MISSING');
        setSummaryMessage('Missing API key.', true);
        setCommentsMessage('Add your API key in Options, then try again.', true);
        setCommentStatus('');
        return;
      }

      setSummaryMessage('Generating summary...');
      setCommentsMessage('Generating comments...');

      const aiText = await generateSuggestions(postText, apiKey);
      const parsed = safelyParseAiJson(aiText);

      if (!parsed) {
        showError('AI_INVALID_JSON');
        setSummaryMessage('AI response format was invalid.', true);
        setCommentsMessage('Failed to generate comments.', true);
        setCommentStatus('');
        return;
      }

      clearError();
      renderSuggestions(parsed);
    } catch (error) {
      showError(error instanceof Error ? error.message : 'UNKNOWN');
      setSummaryMessage('Could not generate suggestions. Please try again.', true);
      setCommentsMessage('Failed to generate comments.', true);
      setCommentStatus('');
    } finally {
      generateButton.disabled = false;
      generateButton.textContent = 'Generate Comments';
    }
  });
}
