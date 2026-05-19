const generateButton = document.getElementById('generateBtn');
const summaryElement = document.getElementById('summary');
const suggestedCommentsElement = document.getElementById('suggestedComments');

const MODEL_NAME = 'gpt-4o-mini';

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

const escapeHtml = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const getVisiblePostText = async () => {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!activeTab?.id) {
    throw new Error('No active tab found.');
  }

  return chrome.tabs.sendMessage(activeTab.id, { action: 'GET_VISIBLE_POST_TEXT' });
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
      (comment) => typeof comment?.style === 'string' && typeof comment?.text === 'string',
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
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      temperature: 0.7,
      messages: [
        {
          role: 'system',
          content: 'Return only valid JSON that matches the required schema exactly.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
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
      return `<article class="comment-card"><h3>${style}</h3><p>${text}</p></article>`;
    })
    .join('');

  suggestedCommentsElement.innerHTML = cardsHtml;
  suggestedCommentsElement.classList.remove('placeholder', 'error');
};

if (generateButton) {
  generateButton.addEventListener('click', async () => {
    generateButton.disabled = true;
    generateButton.textContent = 'Loading...';
    setSummaryMessage('Looking for the visible LinkedIn post...');
    setCommentsMessage('Preparing suggestions...');

    try {
      const response = await getVisiblePostText();
      const postText = response?.postText?.trim();

      if (!postText) {
        setSummaryMessage('No visible post found on this page.', true);
        setCommentsMessage('No comments generated.', true);
        return;
      }

      const apiKey = await getStoredApiKey();

      if (!apiKey) {
        setSummaryMessage('Missing API key. Please add it in the extension options page.', true);
        setCommentsMessage('Add your API key in Options, then try again.', true);
        return;
      }

      setSummaryMessage('Generating summary...');
      setCommentsMessage('Generating comments...');

      const aiText = await generateSuggestions(postText, apiKey);
      const parsed = safelyParseAiJson(aiText);

      if (!parsed) {
        throw new Error('Invalid JSON format returned by AI model.');
      }

      renderSuggestions(parsed);
    } catch (error) {
      setSummaryMessage('Could not generate suggestions. Please try again.', true);
      setCommentsMessage('Failed to generate comments.', true);
    } finally {
      generateButton.disabled = false;
      generateButton.textContent = 'Generate Comments';
    }
  });
}
