import { useMemo } from 'react';
import { balanceChartModel } from '../lib/accountDetail';
import type { AccountBalanceHistory } from '../lib/api';
import { minorUnitOf } from '../lib/money';
import classes from './BalanceChart.module.css';

/**
 * Daily balance as a step area chart. The plot is an SVG stretched to its box (non-scaling
 * strokes); axis labels and the end dot are HTML so text stays crisp and readable at any width.
 */
export function BalanceChart({
  points,
  currency,
  label,
}: {
  points: AccountBalanceHistory['points'];
  currency: string;
  label: string;
}) {
  const m = useMemo(() => balanceChartModel(points, minorUnitOf(currency)), [points, currency]);
  return (
    <div className={classes.root} role="img" aria-label={label}>
      <div className={classes.plot}>
        <svg className={classes.svg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {m.yTicks.map((t) => (
            <line
              key={t.topPct}
              className={classes.grid}
              x1={0}
              x2={100}
              y1={t.topPct}
              y2={t.topPct}
            />
          ))}
          {points.length > 1 && <path className={classes.area} d={m.area} />}
          {points.length > 1 && <path className={classes.line} d={m.line} />}
        </svg>
        <span
          className={classes.dot}
          style={{ left: `${m.last.leftPct}%`, top: `${m.last.topPct}%` }}
          aria-hidden
        />
      </div>
      <div className={classes.yAxis} aria-hidden>
        {m.yTicks.map((t) => (
          <span key={t.topPct} className={classes.yTick} style={{ top: `${t.topPct}%` }}>
            {t.label}
          </span>
        ))}
      </div>
      <div className={classes.xAxis} aria-hidden>
        {m.xTicks.map((t) => (
          <span
            key={t.leftPct}
            className={classes.xTick}
            data-align={t.align}
            style={{ left: `${t.leftPct}%` }}
          >
            {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}
