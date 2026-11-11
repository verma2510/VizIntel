import React from "react";
import { useNavigate } from "react-router-dom";
import type { Correlation } from "../../lib/analysis";
import type { PreparedDataset } from "../../lib/data/prepare";
import { CHROME, divergingColor, hexToRgb } from "../../lib/chart/theme";
import { useResolvedTheme } from "../../lib/prefs";
import { builderUrl } from "../../lib/spec";

const luminance = (hex: string) => {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/**
 * Pearson correlation heatmap between metric columns. Diverging scale: red (negative) ↔ gray (none) ↔
 * blue (positive). Every cell prints its r value, so colour is never the only channel. Click a cell to
 * open the scatter plot behind it.
 */
export const CorrelationMatrix: React.FC<{ ds: PreparedDataset; correlations: Correlation[] }> = ({ ds, correlations }) => {
  const theme = useResolvedTheme();
  const navigate = useNavigate();
  const cols = [...new Set(correlations.flatMap((c) => [c.a, c.b]))];
  if (cols.length < 2) return <p className="py-8 text-center text-[13px] text-ink-3">At least two numeric columns are needed for correlations.</p>;
  const lookup = new Map<string, Correlation>();
  for (const c of correlations) {
    lookup.set(`${c.a}|${c.b}`, c);
    lookup.set(`${c.b}|${c.a}`, c);
  }
  const label = (n: string) => ds.field(n)?.label ?? n;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-[3px] text-[12px]">
          <thead>
            <tr>
              <th />
              {cols.map((c) => (
                <th key={c} scope="col" className="h-24 w-14 align-bottom font-medium text-ink-2">
                  <span className="block max-w-[56px] origin-bottom-left translate-x-6 -rotate-45 truncate whitespace-nowrap text-left" title={label(c)}>
                    {label(c)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cols.map((row) => (
              <tr key={row}>
                <th scope="row" className="max-w-[140px] truncate pr-2 text-right font-medium text-ink-2" title={label(row)}>
                  {label(row)}
                </th>
                {cols.map((col) => {
                  if (row === col) return <td key={col} className="h-11 w-14 rounded-md bg-surface-3 text-center text-ink-3">1</td>;
                  const c = lookup.get(`${row}|${col}`);
                  if (!c) return <td key={col} className="h-11 w-14 rounded-md bg-surface-2" />;
                  const bg = divergingColor(c.r, theme);
                  const ink = luminance(bg) > 0.4 ? CHROME.light.ink : "#ffffff";
                  return (
                    <td key={col} className="p-0">
                      <button
                        type="button"
                        onClick={() => navigate(builderUrl(ds.id, { type: "scatter", x: row, y: [col], agg: "sum", title: `${label(col)} vs ${label(row)}` }))}
                        className="vz-num h-11 w-14 rounded-md text-center font-medium transition-transform hover:scale-105 focus-visible:scale-105"
                        style={{ background: bg, color: ink }}
                        title={`${label(row)} × ${label(col)}: r = ${c.r.toFixed(3)} (n = ${c.n})`}
                        aria-label={`Correlation between ${label(row)} and ${label(col)}: ${c.r.toFixed(2)}`}
                      >
                        {c.r.toFixed(2)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex items-center gap-3 text-[11px] text-ink-3">
        <span>−1 opposite</span>
        <span className="h-2 w-40 rounded-full" style={{ background: `linear-gradient(90deg, ${divergingColor(-1, theme)}, ${divergingColor(0, theme)}, ${divergingColor(1, theme)})` }} />
        <span>+1 together</span>
      </div>
    </div>
  );
};
