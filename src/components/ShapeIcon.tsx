function shapePoints(shape: string, cx: number, cy: number, r: number): string {
  switch (shape) {
    case "star": {
      const pts: string[] = [];
      const inner = r * 0.42;
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? r : inner;
        const angle = -Math.PI / 2 + (Math.PI / 5) * i;
        pts.push(`${cx + rad * Math.cos(angle)},${cy + rad * Math.sin(angle)}`);
      }
      return pts.join(" ");
    }
    case "diamond": {
      const rx = r * 0.78;
      return `${cx},${cy - r} ${cx + rx},${cy} ${cx},${cy + r} ${cx - rx},${cy}`;
    }
    case "triangle": {
      return `${cx},${cy - r} ${cx + r * Math.cos(Math.PI / 6)},${cy + r * Math.sin(Math.PI / 6)} ${cx - r * Math.cos(Math.PI / 6)},${cy + r * Math.sin(Math.PI / 6)}`;
    }
    case "hexagon": {
      const pts: string[] = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
      }
      return pts.join(" ");
    }
    case "pentagon": {
      const pts: string[] = [];
      for (let i = 0; i < 5; i++) {
        const angle = (Math.PI * 2 / 5) * i - Math.PI / 2;
        pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
      }
      return pts.join(" ");
    }
    default:
      return "";
  }
}

export default function ShapeIcon({ shape, color, filled, size = 10 }: { shape: string; color: string; filled: boolean; size?: number }) {
  const s = size;
  const cx = s / 2, cy = s / 2, r = s / 2 - 0.5;
  const fill = filled ? color : "transparent";
  const stroke = color;
  const sw = 1;

  if (shape === "circle") {
    return (
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} className="shrink-0">
        <circle cx={cx} cy={cy} r={r} fill={fill} stroke={stroke} strokeWidth={sw} />
      </svg>
    );
  }

  if (shape === "square") {
    const inset = 0.5;
    const side = s - inset * 2;
    return (
      <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} className="shrink-0">
        <rect x={inset} y={inset} width={side} height={side} rx={1} fill={fill} stroke={stroke} strokeWidth={sw} />
      </svg>
    );
  }

  const pts = shapePoints(shape, cx, cy, r);
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} className="shrink-0">
      <polygon points={pts} fill={fill} stroke={stroke} strokeWidth={sw} />
    </svg>
  );
}
