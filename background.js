const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const FREE_MODEL_POOL = [
  { id: 'deepseek/deepseek-v4-flash:free', tier: 'quality', label: 'DeepSeek V4 Flash' },
  { id: 'openai/gpt-oss-120b:free', tier: 'quality', label: 'OpenAI GPT OSS 120B' },
  { id: 'deepseek/deepseek-v3.1:free', tier: 'quality', label: 'DeepSeek V3.1' },
  { id: 'deepseek/deepseek-chat-v3-0324:free', tier: 'quality', label: 'DeepSeek Chat V3' },
  { id: 'qwen/qwen3-next-80b-a3b-instruct:free', tier: 'quality', label: 'Qwen3 Next 80B' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', tier: 'quality', label: 'Llama 3.3 70B' },
  { id: 'google/gemma-3-27b-it:free', tier: 'balanced', label: 'Gemma 3 27B' },
  { id: 'nvidia/nemotron-3-nano-30b-a3b:free', tier: 'fallback', label: 'NVIDIA Nemotron 3 Nano 30B' },
  { id: 'openai/gpt-oss-20b:free', tier: 'fallback', label: 'OpenAI GPT OSS 20B' },
  { id: 'openrouter/free', tier: 'router', label: 'OpenRouter Free Router' }
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

  return { ok: false, error: 'Unable to parse valid structured output from model.' };
}

function getStoredApiKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['aiApiKey'], (result) => resolve(result?.aiApiKey?.trim() || ''));
  });
}

function buildUserPrompt(postText) {
  return `Extracted LinkedIn post text:\n\n${postText}\n\nWrite comments that directly reference specific ideas from this post. Avoid generic praise, vague remarks, and filler statements. Return ONLY valid JSON (no markdown, no prose) and strictly follow this exact schema:\n{"summary":"1-2 line summary of the actual post","comments":[{"style":"Insightful","text":"..."},{"style":"Supportive","text":"..."},{"style":"Question","text":"..."},{"style":"Contrarian","text":"..."}]}`;
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
    { role: 'system', content: 'You are an expert LinkedIn engagement writer. Write thoughtful, highly contextual comments that directly reference the post content. Avoid generic praise. Avoid vague statements. Each comment should feel human, specific, and naturally conversational.' },
    { role: 'user', content: buildUserPrompt(postText) }
  ];

  const attemptedModels = [];

  for (let index = 0; index < FREE_MODEL_POOL.length; index += 1) {
    const modelEntry = FREE_MODEL_POOL[index];
    attemptedModels.push(modelEntry.id);
    console.log('[OpenRouter] model attempted:', modelEntry.id);
    let response;
    let rawResponseText = '';

    try {
      response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: modelEntry.id,
          response_format: { type: 'json_object' },
          messages
        })
      });
      rawResponseText = await response.text();
    } catch (networkError) {
      console.warn('[OpenRouter] moving to next model due to network failure:', modelEntry.id, networkError);
      continue;
    }

    console.log('[OpenRouter] status code:', response.status);
    console.log('[OpenRouter] raw response preview:', rawResponseText.slice(0, 300));

    if (!response.ok) {
      if (response.status === 400 || shouldTryNextModel(response.status, rawResponseText)) {
        console.warn('[OpenRouter] moving to next model due to HTTP status:', response.status, modelEntry.id);
        continue;
      }
      console.warn('[OpenRouter] moving to next model due to non-ok response:', response.status, modelEntry.id);
      continue;
    }

    let data;
    try {
      data = JSON.parse(rawResponseText);
    } catch (error) {
      console.warn('[OpenRouter] parse failure on API envelope, moving to next model:', modelEntry.id, error);
      continue;
    }

    const modelContent = String(data?.choices?.[0]?.message?.content || '');
    if (!modelContent.trim()) {
      console.warn('[OpenRouter] moving to next model due to empty response content:', modelEntry.id);
      continue;
    }

    console.log('[OpenRouter] model content preview:', modelContent.slice(0, 300));

    const parsed = parseAiJson(modelContent, postText);
    if (!parsed.ok) {
      console.warn('[OpenRouter] parse failure, moving to next model:', modelEntry.id, parsed.error);
      continue;
    }

    console.log('[OpenRouter] parse success for model:', modelEntry.id);
    const fallbackLevel = index === 0 ? 'primary' : 'model_fallback';
    console.log('[OpenRouter] final model used:', modelEntry.id);
    console.log('[OpenRouter] local fallback activated: false');
    return {
      ...parsed.data,
      modelUsed: modelEntry.id,
      modelLabel: modelEntry.label,
      modelTier: modelEntry.tier,
      fallbackLevel,
      attemptedModels,
      usedLocalFallback: false
    };
  }

  const localFallback = buildLocalFallbackFromPost(postText);
  console.warn('[OpenRouter] local fallback activated after all free models failed');
  return {
    ...localFallback,
    modelUsed: null,
    modelLabel: null,
    modelTier: null,
    fallbackLevel: 'local_fallback',
    attemptedModels,
    usedLocalFallback: true
  };
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
