import { sparkline } from '../lib/home';
import classes from './Sparkline.module.css';

interface Props {
  /** minor-unit strings, oldest first */
  values: readonly string[];
  /** accessible description of the trend */
  label: string;
  height?: number;
}

const W = 320;

/** Small trend line (inline SVG, theme colors via CSS). The last point is marked. */
export function Sparkline({ values, label, height = 96 }: Props) {
  const s = sparkline(values, W, height, 8);
  const last = s.points.at(-1);
  return (
    <svg className={classes.svg} viewBox={`0 0 ${W} ${height}`} role="img" aria-label={label}>
      {s.points.length > 1 && (
        <path className={classes.area} d={`${s.path} L${W - 8},${height} L8,${height} Z`} />
      )}
      {s.points.length > 1 && <path className={classes.line} d={s.path} />}
      {last && <circle className={classes.dot} cx={last.x} cy={last.y} r={4} />}
    </svg>
  );
}
