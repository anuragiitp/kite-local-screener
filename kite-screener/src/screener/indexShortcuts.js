export const INDEX_SHORTCUTS = [
  { id: 'nifty', displayName: 'NIFTY 50', tradingsymbol: 'NIFTY 50', segment: 'INDICES', exchange: 'INDICES', instrument_token: 256265 },
  { id: 'banknifty', displayName: 'NIFTY BANK', tradingsymbol: 'NIFTY BANK', segment: 'INDICES', exchange: 'INDICES', instrument_token: 260105 },
  { id: 'midcap100', displayName: 'NIFTY MIDCAP 100', tradingsymbol: 'NIFTY MIDCAP 100', segment: 'INDICES', exchange: 'INDICES', instrument_token: 256777 },
  { id: 'smlcap100', displayName: 'NIFTY SMLCAP 100', tradingsymbol: 'NIFTY SMLCAP 100', segment: 'INDICES', exchange: 'INDICES', instrument_token: 267017 },
  { id: 'next50', displayName: 'NIFTY NEXT 50', tradingsymbol: 'NIFTY NEXT 50', segment: 'INDICES', exchange: 'INDICES', instrument_token: 270857 },
  { id: 'fmcg', displayName: 'NIFTY FMCG', tradingsymbol: 'NIFTY FMCG', segment: 'INDICES', exchange: 'INDICES', instrument_token: 261897 },
  { id: 'it', displayName: 'NIFTY IT', tradingsymbol: 'NIFTY IT', segment: 'INDICES', exchange: 'INDICES', instrument_token: 259849 },
  { id: 'goldbees', displayName: 'GOLDBEES', tradingsymbol: 'GOLDBEES', segment: 'NSE', exchange: 'NSE', instrument_token: 3693569 },
  { id: 'pharma', displayName: 'NIFTY PHARMA', tradingsymbol: 'NIFTY PHARMA', segment: 'INDICES', exchange: 'INDICES', instrument_token: 262409 },
  { id: 'auto', displayName: 'NIFTY AUTO', tradingsymbol: 'NIFTY AUTO', segment: 'INDICES', exchange: 'INDICES', instrument_token: 263433 },
  { id: 'indiavix', displayName: 'INDIA VIX', tradingsymbol: 'INDIA VIX', segment: 'INDICES', exchange: 'INDICES', instrument_token: 264969 },
];

export function matchIndexShortcut(row) {
  if (!row?.tradingsymbol) return null;
  const symbol = row.tradingsymbol.trim().toUpperCase();
  const segment = (row.segment || row.exchange || '').toUpperCase();
  return INDEX_SHORTCUTS.find((item) => (
    item.tradingsymbol.toUpperCase() === symbol
    && (item.segment || '').toUpperCase() === segment
  )) || null;
}
