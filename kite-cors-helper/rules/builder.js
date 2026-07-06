export function buildLocalScreenerRules(enabled = true) {
  if (!enabled) return [];

  return [
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
