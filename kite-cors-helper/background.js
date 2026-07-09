import { buildLocalScreenerRules } from './rules/builder.js';
import { getInstrumentDumpEntries } from './instrumentDump.js';



const LOCAL_SCREENER_PATH = '/local-screener';

const LOCAL_SCREENER_URL = `https://kite.zerodha.com${LOCAL_SCREENER_PATH}`;

const ENABLED_KEY = 'kite-local-screener-enabled';



async function isEnabled() {

  const stored = await chrome.storage.local.get(ENABLED_KEY);

  return stored[ENABLED_KEY] !== false;

}



async function applyRules() {

  const enabled = await isEnabled();

  const existing = await chrome.declarativeNetRequest.getDynamicRules();

  const removeRuleIds = existing.map((rule) => rule.id);



  await chrome.declarativeNetRequest.updateDynamicRules({

    removeRuleIds,

    addRules: buildLocalScreenerRules(enabled),

  });

}



function isLocalScreenerUrl(urlString) {

  try {

    const url = new URL(urlString);

    return url.hostname === 'kite.zerodha.com' && url.pathname.startsWith(LOCAL_SCREENER_PATH);

  } catch {

    return false;

  }

}



async function injectLocalScreener(tabId) {

  if (!(await isEnabled())) return;



  await chrome.scripting.executeScript({

    target: { tabId },

    world: 'MAIN',

    func: () => {

      if (document.getElementById('kite-local-screener-mounted')) return;



      document.documentElement.style.height = '100%';

      document.body.innerHTML = '';

      document.body.style.margin = '0';

      document.body.style.height = '100%';

      document.body.style.overflow = 'hidden';



      const marker = document.createElement('div');

      marker.id = 'kite-local-screener-mounted';

      marker.style.display = 'none';

      document.body.appendChild(marker);



      const root = document.createElement('div');

      root.id = 'root';

      root.style.minHeight = '100vh';

      document.body.appendChild(root);

    },

  });



  await chrome.scripting.insertCSS({

    target: { tabId },

    files: ['app/assets/app.css'],

  });



  await chrome.scripting.executeScript({

    target: { tabId },

    files: ['app/assets/app.js'],

    world: 'MAIN',

  });

}



chrome.runtime.onInstalled.addListener(async () => {

  await applyRules();

});



chrome.runtime.onStartup.addListener(async () => {

  await applyRules();

});



chrome.webNavigation.onCompleted.addListener(async (details) => {

  if (details.frameId !== 0) return;

  if (!isLocalScreenerUrl(details.url)) return;



  try {

    await injectLocalScreener(details.tabId);

  } catch (error) {

    console.error('Failed to inject local screener', error);

  }

});



chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

  (async () => {

    if (message.type === 'openLocalScreener') {

      await chrome.tabs.create({ url: LOCAL_SCREENER_URL });

      sendResponse({ ok: true, url: LOCAL_SCREENER_URL });

      return;

    }



    if (message.type === 'setEnabled') {

      await chrome.storage.local.set({ [ENABLED_KEY]: Boolean(message.enabled) });

      await applyRules();

      sendResponse({ ok: true, enabled: await isEnabled() });

      return;

    }



    if (message.type === 'getEnabled') {

      sendResponse({ ok: true, enabled: await isEnabled() });

      return;

    }



    if (message.type === 'activateLocalScreener' && _sender.tab?.id) {

      await injectLocalScreener(_sender.tab.id);

      sendResponse({ ok: true });

      return;

    }



    if (message.type === 'getEnctoken') {

      try {

        const [enctoken, userId] = await Promise.all([

          chrome.cookies.get({ url: 'https://kite.zerodha.com', name: 'enctoken' }),

          chrome.cookies.get({ url: 'https://kite.zerodha.com', name: 'user_id' }),

        ]);

        sendResponse({

          ok: true,

          enctoken: enctoken?.value || '',

          userId: userId?.value || '',

        });

      } catch (error) {

        sendResponse({ ok: false, error: error?.message || 'Failed to read Kite session cookie' });

      }

      return;

    }



    if (message.type === 'getInstrumentDump') {

      try {

        const entries = await getInstrumentDumpEntries();

        sendResponse({ ok: true, entries });

      } catch (error) {

        sendResponse({ ok: false, error: error?.message || 'Failed to load instrument dump' });

      }

      return;

    }



    sendResponse({ ok: false, error: 'Unknown message type' });

  })();



  return true;

});

