import { ImageResponse } from "next/og";

export const alt = "QuestCite — evidence to reviewed answers";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          color: "#eef7fb",
          background: "linear-gradient(135deg, #0b1f33 0%, #17476a 100%)",
          fontFamily: "Arial",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ color: "#67d8c0", fontSize: 24, fontWeight: 700, letterSpacing: 3 }}>QUESTCITE</div>
          <div style={{ marginTop: 34, fontSize: 66, fontWeight: 700 }}>Evidence to</div>
          <div style={{ fontSize: 66, fontWeight: 700 }}>defensible answers.</div>
          <div style={{ marginTop: 20, color: "#bdd0dd", fontSize: 26 }}>Security questionnaires · human review · Trust Center</div>
        </div>
        <div style={{ display: "flex", gap: 18 }}>
          {[
            ["01", "Evidence"],
            ["02", "Draft"],
            ["03", "Review"],
            ["04", "Export"],
          ].map(([number, label]) => (
            <div key={number} style={{ display: "flex", flexDirection: "column", padding: "22px 26px", width: 220, borderRadius: 16, background: "#f7fbfd", color: "#0b1f33" }}>
              <div style={{ fontSize: 20, color: "#4b6577" }}>{number}</div>
              <div style={{ marginTop: 8, fontSize: 24, fontWeight: 700 }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
