const apiKeyInput = document.getElementById('apiKey');
const saveButton = document.getElementById('saveButton');
const status = document.getElementById('status');

function showSavedConfirmation() {
  status.classList.add('visible');
  window.setTimeout(() => {
    status.classList.remove('visible');
  }, 1200);
}

function loadSavedApiKey() {
  chrome.storage.local.get(['aiApiKey'], (result) => {
    apiKeyInput.value = result.aiApiKey || '';
  });
}

function saveApiKey() {
  const aiApiKey = apiKeyInput.value.trim();
  chrome.storage.local.set({ aiApiKey }, () => {
    showSavedConfirmation();
  });
}

saveButton.addEventListener('click', saveApiKey);
document.addEventListener('DOMContentLoaded', loadSavedApiKey);
