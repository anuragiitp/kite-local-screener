# Strategies

Each strategy has its own rulebook. A rulebook is the complete, self-contained definition used to run the strategy. The research behind each one lives in [backtest/](../backtest/).

| Code | Name | Style | Universe | Rebalance | Status | Rulebook |
|---|---|---|---|---|---|---|
| SUMMIT-20 | Summit Momentum | Cross-sectional momentum, long only | Nifty 500 | Monthly (weekly optional) | Active, v1.0 | [summit-momentum.md](summit-momentum.md) |

## Conventions for new strategies

- One file per strategy: `strategies/<name>.md`, with a short uppercase code (for example `SUMMIT-20`).
- Every rulebook has the same sections:
  1. Identity card
  2. Backtest performance
  3. Rules
  4. Operating checklist
  5. Special situations
  6. Costs and tax
  7. Risks and expectations
  8. Discipline
  9. Reproduce
  10. Changelog
- Any rule change creates a new version in the changelog, and it needs a full backtest first.
