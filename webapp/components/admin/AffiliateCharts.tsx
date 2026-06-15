"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { CommissionPoint } from "@/lib/api";
import { fmtUsd } from "@/lib/format";

const TOOLTIP = {
  contentStyle: {
    background: "#181A20",
    border: "1px solid #2B3139",
    borderRadius: 10,
    fontSize: 12,
    color: "#EAECEF",
  },
  labelStyle: { color: "#7A8290" },
};

export function CommissionChart({ data }: { data: CommissionPoint[] }) {
  const rows = data.map((d) => ({
    date: d.date.slice(5), // MM-DD
    commission: Number(d.commission),
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="commFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0AFFE0" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#0AFFE0" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#2B3139" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" stroke="#7A8290" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis stroke="#7A8290" fontSize={11} tickLine={false} axisLine={false} width={48} />
          <Tooltip {...TOOLTIP} formatter={((v: number | string) => [`${fmtUsd(v, 4)}$`, "Комиссия"]) as never} />
          <Area
            type="monotone"
            dataKey="commission"
            stroke="#0AFFE0"
            strokeWidth={2}
            fill="url(#commFill)"
            dot={false}
            activeDot={{ r: 4, fill: "#0AFFE0" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function VolumeDonut({ spot, futures }: { spot: number; futures: number }) {
  const total = spot + futures;
  const data = [
    { name: "Фьючерсы", value: futures, color: "#0AFFE0" },
    { name: "Спот", value: spot, color: "#F0B90B" },
  ];

  return (
    <div className="relative h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={62}
            outerRadius={90}
            paddingAngle={2}
            stroke="none"
          >
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
          <Tooltip {...TOOLTIP} formatter={((v: number | string, n: string) => [`${fmtUsd(v)}$`, n]) as never} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs text-text-muted">Объём</span>
        <span className="font-mono text-lg font-bold text-white">{fmtUsd(total)}$</span>
      </div>
    </div>
  );
}
