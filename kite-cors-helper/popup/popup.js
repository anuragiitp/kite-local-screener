function sendMessage(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

async function load() {
  const response = await sendMessage('getEnabled');
  document.getElementById('master-toggle').checked = response.enabled;
}

document.getElementById('master-toggle').addEventListener('change', async (event) => {
  await sendMessage('setEnabled', { enabled: event.target.checked });
});

document.getElementById('open-local-screener').addEventListener('click', async () => {
  await sendMessage('openLocalScreener');
  window.close();
});

load();
