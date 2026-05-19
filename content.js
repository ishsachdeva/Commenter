const UI_NOISE_PHRASES = [
  'Like',
  'Comment',
  'Repost',
  'Send',
  'Share',
  'Follow',
  'Promoted',
  'Sponsored'
];

function isElementVisible(element) {
  if (!element || !(element instanceof HTMLElement)) {
    return false;
  }

  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return false;
  }

  return rect.bottom > 0 && rect.top < window.innerHeight;
}

function getFeedPostCandidates() {
  const selectors = [
    'div.feed-shared-update-v2',
    'div[data-urn*="activity"]',
    'article[data-id]',
    'main [role="article"]',
    '.scaffold-finite-scroll__content > div > div'
  ];

  const nodes = new Set();
  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach((node) => nodes.add(node));
  }

  return Array.from(nodes).filter((node) => {
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    if (!isElementVisible(node)) {
      return false;
    }

    // Filter out tiny utility containers.
    const rect = node.getBoundingClientRect();
    return rect.height > 140;
  });
}

function selectBestVisiblePost(posts) {
  if (!posts.length) {
    return null;
  }

  const viewportTop = 0;
  const viewportCenterY = window.innerHeight / 2;

  return posts
    .map((post) => {
      const rect = post.getBoundingClientRect();
      const postCenterY = rect.top + rect.height / 2;
      const topDistance = Math.abs(rect.top - viewportTop);
      const centerDistance = Math.abs(postCenterY - viewportCenterY);
      // Weighted for "near top" but still factoring center proximity.
      const score = topDistance * 0.6 + centerDistance * 0.4;
      return { post, score };
    })
    .sort((a, b) => a.score - b.score)[0].post;
}

function cleanPostText(rawText) {
  if (!rawText) {
    return '';
  }

  const lines = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      if (/^(\d+\s*)?(like|comment|repost|send|share|follow)s?$/i.test(line)) {
        return false;
      }

      return !UI_NOISE_PHRASES.includes(line);
    });

  const deduped = [];
  for (const line of lines) {
    if (deduped[deduped.length - 1] !== line) {
      deduped.push(line);
    }
  }

  return deduped.join('\n').trim();
}

function extractPostText(post) {
  if (!post) {
    return '';
  }

  const textSelectors = [
    '.update-components-text',
    '.feed-shared-update-v2__description',
    '.feed-shared-inline-show-more-text',
    '[data-test-id="main-feed-activity-card__commentary"]',
    '[dir="ltr"]'
  ];

  const textChunks = [];
  for (const selector of textSelectors) {
    const nodes = post.querySelectorAll(selector);
    nodes.forEach((node) => {
      const text = node.textContent?.trim();
      if (text) {
        textChunks.push(text);
      }
    });
    if (textChunks.length) {
      break;
    }
  }

  const fallbackText = post.innerText || post.textContent || '';
  const candidateText = textChunks.length ? textChunks.join('\n') : fallbackText;
  return cleanPostText(candidateText);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.action !== 'GET_VISIBLE_POST_TEXT') {
    return false;
  }

  try {
    const posts = getFeedPostCandidates();
    const bestPost = selectBestVisiblePost(posts);
    const postText = extractPostText(bestPost);

    sendResponse({
      success: Boolean(postText),
      text: postText || '',
      error: postText ? undefined : 'No visible post text found.'
    });
  } catch (error) {
    sendResponse({
      success: false,
      text: '',
      error: error instanceof Error ? error.message : 'Unknown extraction error.'
    });
  }

  return true;
});
