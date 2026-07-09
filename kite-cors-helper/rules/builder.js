export function buildLocalScreenerRules(enabled = true) {
  if (!enabled) return [];

  return [
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
