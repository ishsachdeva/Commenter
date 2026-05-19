const openOptionsButton = document.getElementById('openOptions');

if (openOptionsButton) {
  openOptionsButton.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
      return;
    }
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
  });
}
