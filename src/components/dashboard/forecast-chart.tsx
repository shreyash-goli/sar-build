"use client";

import { Bar, BarChart, Cell, Tooltip, XAxis, YAxis } from "recharts";

import type { DashboardData } from "@/lib/dashboard/schema";
import { formatCents } from "@/lib/schema/money";
import { formatDayUtc } from "./format";

/*
 * Tiny per-vendor charge forecast (small multiples, one series each).
 * Colours validated with the dataviz validator on the dark surface (#FFFFFF):
 * cleared history is the de-emphasis gray, upcoming charges the accent cyan.
 * Unknown amounts are never drawn as $0: no bar, an explicit "Unknown" note,
 * and the table view lists them.
 */
const CLEARED = "#888582";
const UPCOMING = "#17647A";

type Forecast = DashboardData["forecast"][number];
type Point = Forecast["points"][number];

const KIND_LABEL: Record<Point["kind"], string> = {
  CLEARED: "Cleared",
  SCHEDULED: "Scheduled",
  FORECAST: "Forecast",
  RESCHEDULED: "Rescheduled",
};

const shortDay = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(iso));

function TooltipBody({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: Point }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload;
  return (
    <div className="rounded-md border border-border-strong bg-surface-raised px-2.5 py-1.5 text-xs shadow-lg">
      <p className="font-medium text-foreground">
        {formatCents(p.amountCents)}
      </p>
      <p className="text-muted">
        {KIND_LABEL[p.kind]} · {formatDayUtc(p.at)}
      </p>
    </div>
  );
}

function VendorPanel({ forecast }: { forecast: Forecast }) {
  const data = forecast.points.map((p) => ({
    ...p,
    label: shortDay(p.at),
    value: p.amountCents,
  }));
  const unknown = forecast.points.filter((p) => p.amountCents === null);
  const next = forecast.points.find((p) => p.kind !== "CLEARED");

  return (
    <figure
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface p-3"
      data-vendor-id={forecast.vendorId}
    >
      <figcaption className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium text-foreground">
          {forecast.vendorName}
        </span>
        {next ? (
          <span className="shrink-0 text-xs text-muted">
            next{" "}
            <span className="font-medium text-foreground tabular-nums">
              {formatCents(next.amountCents)}
            </span>
          </span>
        ) : null}
      </figcaption>
      {data.length === 0 ? (
        <p className="flex h-[88px] items-center justify-center text-xs text-subtle">
          No cleared history or upcoming charges recorded.
        </p>
      ) : (
        <div aria-hidden="true">
          <BarChart
            responsive
            style={{ width: "100%", height: 88 }}
            data={data}
            margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
            barCategoryGap={6}
          >
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: "#E2DFDB" }}
              tick={{ fill: "#6E6A65", fontSize: 10 }}
              interval="preserveStartEnd"
            />
            <YAxis hide domain={[0, "dataMax"]} />
            <Tooltip
              content={<TooltipBody />}
              cursor={{ fill: "rgb(255 255 255 / 0.04)" }}
              isAnimationActive={false}
            />
            <Bar
              dataKey="value"
              maxBarSize={18}
              radius={[4, 4, 0, 0]}
              isAnimationActive={false}
            >
              {data.map((p) => (
                <Cell
                  key={`${p.sourceId}-${p.at}`}
                  fill={p.kind === "CLEARED" ? CLEARED : UPCOMING}
                />
              ))}
            </Bar>
          </BarChart>
        </div>
      )}
      {unknown.length ? (
        <p className="text-xs text-warning">
          Amount unknown for {unknown.map((p) => formatDayUtc(p.at)).join(", ")}{" "}
          (not shown as $0)
        </p>
      ) : null}
    </figure>
  );
}

export function ForecastChart({
  forecast,
}: {
  forecast: DashboardData["forecast"];
}) {
  if (forecast.length === 0) {
    return (
      <p className="text-sm text-muted">
        No charge history or upcoming charges are recorded.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-testid="forecast">
      <ul
        className="flex flex-wrap items-center gap-4 text-xs text-muted"
        aria-label="Forecast legend"
      >
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-sm"
            style={{ background: CLEARED }}
          />
          Cleared (history)
        </li>
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-sm"
            style={{ background: UPCOMING }}
          />
          Upcoming (scheduled or forecast)
        </li>
        <li className="text-subtle">Each vendor has its own scale.</li>
      </ul>
      <div className="grid gap-3 sm:grid-cols-2">
        {forecast.map((f) => (
          <VendorPanel key={f.vendorId} forecast={f} />
        ))}
      </div>
      <details className="text-sm">
        <summary className="w-fit cursor-pointer rounded text-xs font-medium text-info hover:underline">
          View forecast as a table
        </summary>
        <div className="mt-2 overflow-x-auto rounded-lg border border-border">
          <table
            className="w-full min-w-[28rem] text-left text-xs"
            data-testid="forecast-table"
          >
            <caption className="sr-only">
              Charge history and upcoming charges by vendor
            </caption>
            <thead className="bg-surface-raised text-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Vendor
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Date
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Kind
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {forecast.flatMap((f) =>
                f.points.map((p) => (
                  <tr
                    key={`${f.vendorId}-${p.sourceId}-${p.at}`}
                    className="border-t border-border"
                  >
                    <td className="px-3 py-1.5 text-foreground">
                      {f.vendorName}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-muted">
                      {formatDayUtc(p.at)}
                    </td>
                    <td className="px-3 py-1.5 text-muted">
                      {KIND_LABEL[p.kind]}
                    </td>
                    <td
                      className={`px-3 py-1.5 text-right font-mono ${p.amountCents === null ? "text-warning" : "text-foreground"}`}
                    >
                      {formatCents(p.amountCents)}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
