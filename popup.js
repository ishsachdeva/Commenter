const generateButton = document.getElementById('generateBtn');
const summaryElement = document.getElementById('summary');

const setSummaryMessage = (message, isError = false) => {
  if (!summaryElement) {
    return;
  }

  summaryElement.textContent = message;
  summaryElement.classList.toggle('error', isError);
};

const getVisiblePostText = async () => {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!activeTab?.id) {
    throw new Error('No active tab found.');
  }

  return chrome.tabs.sendMessage(activeTab.id, { action: 'GET_VISIBLE_POST_TEXT' });
};

if (generateButton) {
  generateButton.addEventListener('click', async () => {
    generateButton.disabled = true;
    generateButton.textContent = 'Loading...';
    setSummaryMessage('Looking for the visible LinkedIn post...');

    try {
      const response = await getVisiblePostText();
      const postText = response?.postText?.trim();

      if (!postText) {
        setSummaryMessage('No visible post found on this page.', true);
        return;
      }

      setSummaryMessage(`Debug: Extracted post text\n\n${postText}`);
    } catch (error) {
      setSummaryMessage('Could not read a post from this tab. Make sure a LinkedIn feed page is open.', true);
    } finally {
      generateButton.disabled = false;
      generateButton.textContent = 'Generate Comments';
    }
  });
}
