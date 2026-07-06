import { useEffect, useState } from 'react';
import IndexTicker from './IndexTicker';

function formatClock(date) {
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

export default function GlobalFilterBar({
  indexLiveTicks = {},
  indexTokensById = {},
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="global-bar">
      <IndexTicker
        liveTicks={indexLiveTicks}
        tokensById={indexTokensById}
      />
      <time className="header-clock" dateTime={now.toISOString()}>
        {formatClock(now)}
      </time>
    </header>
  );
}
