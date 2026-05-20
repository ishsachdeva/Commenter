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

function buildLocalFallbackFromPost(_postText) {
  return {
    summary: 'This post shares a perspective worth engaging with.',
    comments: [
      { style: 'Insightful', text: 'This is an interesting perspective and it highlights a point many people overlook.' },
      { style: 'Supportive', text: 'Well said. This is a thoughtful reminder and very relevant.' },
      { style: 'Question', text: 'What do you think is the biggest reason people miss this point?' },
      { style: 'Contrarian', text: 'I see this slightly differently, but the core point is definitely worth reflecting on.' }
    ]
  };
}

function parsePlainTextFallback(rawText) {
  const labelPattern = /^(insightful|supportive|question|contrarian)\s*:\s*/i;

  const comments = String(rawText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\s*(?:\d+\.|[-*])\s*/, '').trim())
    .map((line) => line.replace(labelPattern, '').trim())
    .filter((line) => line.length >= 12)
    .slice(0, 4)
    .map((text, index) => ({ style: `Suggestion ${index + 1}`, text }));

  if (comments.length >= 2) {
    return {
      summary: 'Summary could not be parsed, but comments were generated.',
      comments
    };
  }

  return null;
}

function parseAiJson(rawText, postText) {
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

  // d. remove trailing commas and parse
  if (!parsed) {
    const noFences = stripMarkdownCodeFences(raw);
    const start = noFences.indexOf('{');
    const end = noFences.lastIndexOf('}');
    const candidate = start !== -1 && end !== -1 && end > start
      ? noFences.slice(start, end + 1).trim()
      : noFences;
    const repaired = removeTrailingCommas(candidate);
    parsed = tryParseJsonCandidate(repaired);
  }

  // e. replace smart quotes and parse
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

  if (parsed) {
    const validated = validateAndNormalizeAiResult(parsed);
    if (validated.ok) return validated;
  }

  const textFallback = parsePlainTextFallback(raw);
  if (textFallback) {
    const withMinimumComments = [...textFallback.comments];
    const localFallback = buildLocalFallbackFromPost(postText);

    while (withMinimumComments.length < 4) {
      withMinimumComments.push(localFallback.comments[withMinimumComments.length]);
    }

    return {
      ok: true,
      data: {
        summary: textFallback.summary,
        comments: withMinimumComments.slice(0, 4)
      }
    };
  }

  return { ok: true, data: buildLocalFallbackFromPost(postText) };
}

function getStoredApiKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['aiApiKey'], (result) => resolve(result?.aiApiKey?.trim() || ''));
  });
}

function buildUserPrompt(postText) {
  return `POST:\n\n${postText}\n\nReturn ONLY valid JSON. No markdown. No explanation. No bullets outside JSON. Your entire response must start with { and end with }. Use exactly this schema:\n{"summary":"...","comments":[{"style":"Insightful","text":"..."},{"style":"Supportive","text":"..."},{"style":"Question","text":"..."},{"style":"Contrarian","text":"..."}]}`;
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

    const parsed = parseAiJson(modelContent, postText);
    if (!parsed.ok) {
      console.error('Raw AI response:', modelContent);
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
