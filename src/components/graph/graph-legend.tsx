/** Static legend: explains every visual encoding used on the canvas. */
export function GraphLegend() {
  const line = (props: { stroke: string; dash?: string; width?: number }) => (
    <svg aria-hidden="true" width="34" height="8" className="shrink-0">
      <line
        x1="1"
        y1="4"
        x2="33"
        y2="4"
        stroke={props.stroke}
        strokeWidth={props.width ?? 2}
        strokeDasharray={props.dash}
        strokeLinecap="round"
      />
    </svg>
  );
  const items: { key: string; visual: React.ReactNode; label: string }[] = [
    { key: "confirmed", visual: line({ stroke: "#6E6A65" }), label: "Confirmed dependency" },
    { key: "suggested", visual: line({ stroke: "#6E6A65", dash: "7 5" }), label: "Suggested (unreviewed, never counted)" },
    { key: "strength", visual: line({ stroke: "#6E6A65", width: 3 }), label: "Thicker = harder dependency" },
    { key: "downstream", visual: line({ stroke: "#6C7300", width: 3 }), label: "Selected node's downstream paths" },
    { key: "upstream", visual: line({ stroke: "#17647A", width: 3 }), label: "Confirmed funding chain feeding it" },
    { key: "unknown", visual: line({ stroke: "#855600", dash: "7 5" }), label: "Needs mapping: funding lineage unknown (not a risk score)" },
  ];
  return (
    <section aria-labelledby="legend-title" className="flex flex-col gap-2">
      <h2 id="legend-title" className="text-xs font-semibold uppercase tracking-[0.12em] text-subtle">
        Legend
      </h2>
      <ul className="flex flex-col gap-2 text-xs text-muted lg:flex-row lg:flex-wrap lg:gap-x-6">
        {items.map((i) => (
          <li key={i.key} className="flex items-center gap-2">
            {i.visual}
            <span>{i.label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
