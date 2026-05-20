const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL_FALLBACKS = [
  'openrouter/free',
  'openai/gpt-oss-20b:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
  'google/gemma-3-27b-it:free',
  'deepseek/deepseek-chat-v3-0324:free'
];

function stripMarkdownCodeFences(text) {
  return (text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function normalizeSmartQuotes(text) {
  return (text || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
}

function removeTrailingCommas(text) {
  return (text || '').replace(/,\s*([}\]])/g, '$1');
}

function validateAndNormalizeAiResult(parsed) {
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'AI response could not be parsed. Please try again.' };
  if (typeof parsed.summary !== 'string') return { ok: false, error: 'AI response could not be parsed. Please try again.' };
  if (!Array.isArray(parsed.comments)) return { ok: false, error: 'AI response could not be parsed. Please try again.' };

  const normalizedComments = parsed.comments
    .map((comment, index) => {
      if (typeof comment === 'string') {
        const text = comment.trim();
        if (!text) return null;
        return { style: `Comment ${index + 1}`, text };
      }

      if (!comment || typeof comment !== 'object') return null;

      const style = typeof comment.style === 'string' ? comment.style.trim() : '';
      const text = typeof comment.text === 'string' ? comment.text.trim() : '';
      if (!style || !text) return null;
      return { style, text };
    })
    .filter(Boolean);

  if (normalizedComments.length < 4) return { ok: false, error: 'AI returned fewer than 4 usable comments.' };

  return {
    ok: true,
    data: {
      summary: parsed.summary.trim(),
      comments: normalizedComments
    }
  };
}

function tryParseJsonCandidate(candidate) {
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function parseAiJson(rawText) {
  const raw = String(rawText || '').trim();

  // a. direct parse
  let parsed = tryParseJsonCandidate(raw);

  // b. strip fences and parse
  if (!parsed) {
    const noFences = stripMarkdownCodeFences(raw);
    parsed = tryParseJsonCandidate(noFences);
  }

  // c. extract first object braces and parse
  if (!parsed) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      const objectSlice = raw.slice(start, end + 1).trim();
      parsed = tryParseJsonCandidate(objectSlice);
    }
  }

  // d. repair common issues and parse
  if (!parsed) {
    const normalized = normalizeSmartQuotes(raw);
    const noFences = stripMarkdownCodeFences(normalized);
    const start = noFences.indexOf('{');
    const end = noFences.lastIndexOf('}');
    const candidate = start !== -1 && end !== -1 && end > start
      ? noFences.slice(start, end + 1).trim()
      : noFences;
    const repaired = removeTrailingCommas(candidate);
    parsed = tryParseJsonCandidate(repaired);
  }

  if (!parsed) return { ok: false, error: 'AI response could not be parsed. Please try again.' };

  return validateAndNormalizeAiResult(parsed);
}

function getStoredApiKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['aiApiKey'], (result) => resolve(result?.aiApiKey?.trim() || ''));
  });
}

function buildUserPrompt(postText) {
  return `POST:\n\n${postText}\n\nReturn only valid minified JSON. No markdown. No explanation. No code fence. Use exactly this schema:\n{"summary":"...","comments":[{"style":"Insightful","text":"..."},{"style":"Supportive","text":"..."},{"style":"Question","text":"..."},{"style":"Contrarian","text":"..."}]}`;
}

function shouldTryNextModel(status, text) {
  if (status === 429 || status === 404) return true;
  if (status >= 400) {
    const low = String(text || '').toLowerCase();
    if (low.includes('model') && (low.includes('invalid') || low.includes('not found') || low.includes('unknown'))) return true;
  }
  return false;
}

async function generateComments(postText, apiKey) {
  const messages = [
    { role: 'system', content: 'You generate high-quality LinkedIn comment suggestions.' },
    { role: 'user', content: buildUserPrompt(postText) }
  ];

  for (const model of MODEL_FALLBACKS) {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages
      })
    });

    const rawResponseText = await response.text();
    console.log('[OpenRouter] Attempt', { model, status: response.status, preview: rawResponseText.slice(0, 200) });

    if (!response.ok) {
      if (shouldTryNextModel(response.status, rawResponseText)) continue;
      throw new Error(`OpenRouter request failed (${response.status}): ${rawResponseText.slice(0, 200) || response.statusText}`);
    }

    let data;
    try {
      data = JSON.parse(rawResponseText);
    } catch {
      throw new Error('Invalid JSON received from OpenRouter API');
    }

    const modelContent = String(data?.choices?.[0]?.message?.content || '');
    console.log('Raw AI content preview:', modelContent.slice(0, 300));

    const parsed = parseAiJson(modelContent);
    if (!parsed.ok) {
      console.log('Raw AI output (unparsed):', modelContent);
      throw new Error(parsed.error);
    }

    console.log('[OpenRouter] Selected successful model:', model);
    return parsed.data;
  }

  throw new Error('All free models are currently unavailable or rate-limited. Please try again later.');
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
