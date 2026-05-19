const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL_NAME = 'openrouter/free';

function stripMarkdownCodeFences(text) {
  return (text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function safelyParseAiJson(rawText) {
  const cleaned = stripMarkdownCodeFences(rawText);
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed?.summary !== 'string' || !Array.isArray(parsed?.comments) || parsed.comments.length !== 4) return null;
    if (!parsed.comments.every((c) => typeof c?.style === 'string' && typeof c?.text === 'string')) return null;
    return parsed;
  } catch {
    return null;
  }
}

function getStoredApiKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['aiApiKey'], (result) => resolve(result?.aiApiKey?.trim() || ''));
  });
}

function buildUserPrompt(postText) {
  return `POST:\n\n${postText}\n\nReturn STRICT JSON ONLY:\n{\n  "summary": "1-2 line summary",\n  "comments": [\n    {"style":"Insightful","text":"..."},\n    {"style":"Supportive","text":"..."},\n    {"style":"Question","text":"..."},\n    {"style":"Contrarian","text":"..."}\n  ]\n}`;
}

async function generateComments(postText, apiKey) {
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [
        { role: 'system', content: 'You generate high-quality LinkedIn comment suggestions.' },
        { role: 'user', content: buildUserPrompt(postText) }
      ]
    })
  });

  const rawResponseText = await response.text();
  if (!response.ok) {
    throw new Error(`OpenRouter request failed (${response.status}): ${rawResponseText.slice(0, 200) || response.statusText}`);
  }

  let data;
  try {
    data = JSON.parse(rawResponseText);
  } catch {
    throw new Error('Invalid JSON received from OpenRouter API');
  }

  const modelContent = data?.choices?.[0]?.message?.content || '';
  const parsed = safelyParseAiJson(modelContent);
  if (!parsed) throw new Error('AI returned invalid JSON format');
  return parsed;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.action !== 'GENERATE_COMMENTS') return;

  (async () => {
    const postText = String(message?.postText || '').trim();
    if (postText.length < 40) throw new Error('Not enough post text found near this comment area.');

    const apiKey = await getStoredApiKey();
    if (!apiKey) throw new Error('Missing API key. Set it in Options.');

    const result = await generateComments(postText, apiKey);
    sendResponse({ ok: true, data: result });
  })().catch((error) => {
    sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Generation failed' });
  });

  return true;
});
