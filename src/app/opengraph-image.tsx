import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "PolyWorld — Prediction Market World Monitor";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          background: "linear-gradient(135deg, #0a0a0a 0%, #111827 50%, #0a0a0a 100%)",
          fontFamily: "monospace",
        }}
      >
        {/* Grid overlay */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        {/* Category dots */}
        <div style={{ display: "flex", gap: "32px", marginBottom: "32px" }}>
          {[
            { emoji: "🏛️", color: "#79c0ff" },
            { emoji: "₿", color: "#ffa657" },
            { emoji: "🏆", color: "#7ee787" },
            { emoji: "📈", color: "#d2a8ff" },
            { emoji: "💻", color: "#79dfc1" },
            { emoji: "🎭", color: "#f778ba" },
          ].map(({ emoji, color }) => (
            <div
              key={emoji}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "56px",
                height: "56px",
                borderRadius: "50%",
                background: `${color}22`,
                border: `2px solid ${color}55`,
                fontSize: "28px",
              }}
            >
              {emoji}
            </div>
          ))}
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: "64px",
            fontWeight: 800,
            color: "#e5e7eb",
            letterSpacing: "-2px",
            marginBottom: "12px",
          }}
        >
          PolyWorld
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: "24px",
            color: "#9ca3af",
            marginBottom: "28px",
          }}
        >
          Prediction Market World Monitor
        </div>

        {/* Feature pills */}
        <div style={{ display: "flex", gap: "16px" }}>
          {["Smart Money Tracking", "Signal Engine", "Live Trading"].map(
            (label) => (
              <div
                key={label}
                style={{
                  padding: "8px 20px",
                  border: "1px solid #374151",
                  borderRadius: "4px",
                  color: "#9ca3af",
                  fontSize: "16px",
                }}
              >
                {label}
              </div>
            ),
          )}
        </div>
      </div>
    ),
    { ...size },
  );
}
