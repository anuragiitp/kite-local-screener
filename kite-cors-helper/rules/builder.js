export function buildLocalScreenerRules(enabled = true) {
  if (!enabled) return [];

  return [
    {
      // MF "AUM & categories" update: Coin's page + JS bundle (fund table with AUM).
      id: 995,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'access-control-allow-origin', operation: 'set', value: 'https://kite.zerodha.com' },
        ],
      },
      condition: {
        regexFilter: '^https://coin\\.zerodha\\.com/(static/js/[\\w.-]+\\.js)?$',
        resourceTypes: ['xmlhttprequest'],
        initiatorDomains: ['kite.zerodha.com'],
      },
    },
    {
      // MF "AUM & categories" update: AMFI NAV file (SEBI categories).
      id: 996,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'access-control-allow-origin', operation: 'set', value: 'https://kite.zerodha.com' },
        ],
      },
      condition: {
        // www.amfiindia.com 302s to portal.; both hops need the header.
        regexFilter: '^https://(www|portal)\\.amfiindia\\.com/spages/NAVAll\\.txt$',
        resourceTypes: ['xmlhttprequest'],
        initiatorDomains: ['kite.zerodha.com'],
      },
    },
    {
      id: 997,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'access-control-allow-origin', operation: 'set', value: 'https://kite.zerodha.com' },
        ],
      },
      condition: {
        urlFilter: '||api.kite.trade/mf/instruments',
        resourceTypes: ['xmlhttprequest'],
        initiatorDomains: ['kite.zerodha.com'],
      },
    },
    {
      id: 998,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'access-control-allow-origin', operation: 'set', value: 'https://kite.zerodha.com' },
        ],
      },
      condition: {
        urlFilter: '||api.kite.trade/instruments',
        resourceTypes: ['xmlhttprequest'],
        initiatorDomains: ['kite.zerodha.com'],
      },
    },
    {
      id: 999,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'content-security-policy', operation: 'remove' },
          { header: 'x-frame-options', operation: 'remove' },
        ],
      },
      condition: {
        urlFilter: '||kite.zerodha.com/local-screener',
        resourceTypes: ['main_frame', 'sub_frame'],
      },
    },
  ];
}
