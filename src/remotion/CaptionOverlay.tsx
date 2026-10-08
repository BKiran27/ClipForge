import React from "react";
import { useCurrentFrame, interpolate } from "remotion";
import type { CaptionGroup, CaptionOverlayProps, CaptionTheme } from "./types";

const FONT_SIZE = 54;

const THEMES: Record<
  CaptionTheme,
  {
    activeColor: string;
    inactiveColor: string;
    boxBg: string;
    stroke: string;
    scaleEffect?: boolean;
  }
> = {
  hormozi: {
    activeColor: "#FFD700",
    inactiveColor: "#FFFFFF",
    boxBg: "#000000",
    stroke:
      "-3px -3px 0 #000, 3px -3px 0 #000, -3px 3px 0 #000, 3px 3px 0 #000, 0 -3px 0 #000, 0 3px 0 #000, -3px 0 0 #000, 3px 0 0 #000",
    scaleEffect: false,
  },
  mrbeast: {
    activeColor: "#22c55e",
    inactiveColor: "#FFFFFF",
    boxBg: "rgba(0, 0, 0, 0.85)",
    stroke:
      "-4px -4px 0 #000, 4px -4px 0 #000, -4px 4px 0 #000, 4px 4px 0 #000, 0 -4px 0 #000, 0 4px 0 #000, -4px 0 0 #000, 4px 0 0 #000",
    scaleEffect: true,
  },
  neon: {
    activeColor: "#06b6d4",
    inactiveColor: "#f472b6",
    boxBg: "rgba(15, 23, 42, 0.9)",
    stroke: "0 0 15px #06b6d4, 0 0 25px #0891b2",
    scaleEffect: true,
  },
  minimal: {
    activeColor: "#FFFFFF",
    inactiveColor: "rgba(255, 255, 255, 0.5)",
    boxBg: "rgba(0, 0, 0, 0.65)",
    stroke: "0 2px 4px rgba(0,0,0,0.8)",
    scaleEffect: false,
  },
};

const CaptionBox: React.FC<{
  group: CaptionGroup;
  frame: number;
  theme: CaptionTheme;
}> = ({ group, frame, theme }) => {
  const currentTheme = THEMES[theme] || THEMES.hormozi;
  const words = group.words;
  const midpoint = Math.ceil(words.length / 2);
  const line1 = words.slice(0, midpoint);
  const line2 = words.slice(midpoint);

  const renderWord = (word: (typeof words)[0], idx: number) => {
    const isActive = frame >= word.startFrame && frame < word.endFrame;

    let scale = 1;
    if (isActive && currentTheme.scaleEffect) {
      scale = 1.08;
    }

    return (
      <span
        key={idx}
        style={{
          color: isActive ? currentTheme.activeColor : currentTheme.inactiveColor,
          marginRight: 14,
          textShadow: currentTheme.stroke,
          transform: `scale(${scale})`,
          display: "inline-block",
          transition: "transform 0.1s ease-in-out",
        }}
      >
        {word.text.toUpperCase()}
      </span>
    );
  };

  return (
    <div
      style={{
        background: currentTheme.boxBg,
        padding: "14px 24px",
        borderRadius: 12,
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        boxShadow: "0 10px 25px rgba(0, 0, 0, 0.4)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "center" }}>{line1.map(renderWord)}</div>
      {line2.length > 0 && (
        <div style={{ display: "flex", justifyContent: "center" }}>{line2.map(renderWord)}</div>
      )}
    </div>
  );
};

export const CaptionOverlay: React.FC<CaptionOverlayProps> = ({
  groups,
  width,
  height,
  theme = "hormozi",
  hookTitle,
}) => {
  const frame = useCurrentFrame();

  const activeGroup = groups.find((g) => frame >= g.startFrame && frame < g.endFrame);

  // Hook Title banner during the first 3 seconds (0 - 90 frames)
  const showHook = hookTitle && frame < 90;
  const hookOpacity = showHook ? interpolate(frame, [0, 10, 75, 90], [0, 1, 1, 0]) : 0;

  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Plus Jakarta Sans', Arial, Helvetica, sans-serif",
        fontWeight: 900,
        fontSize: FONT_SIZE,
        position: "absolute",
        top: 0,
        left: 0,
        backgroundColor: "#00FF00",
      }}
    >
      {/* 3-Second Attention Grabber Hook Banner */}
      {showHook && (
        <div
          style={{
            position: "absolute",
            top: 140,
            left: 60,
            right: 60,
            display: "flex",
            justifyContent: "center",
            opacity: hookOpacity,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              background:
                "linear-gradient(135deg, rgba(239, 68, 68, 0.95), rgba(249, 115, 22, 0.95))",
              color: "#FFFFFF",
              padding: "16px 32px",
              borderRadius: 16,
              fontSize: 38,
              textAlign: "center",
              boxShadow: "0 12px 30px rgba(0,0,0,0.6)",
              textShadow: "0 2px 4px rgba(0,0,0,0.5)",
              border: "3px solid #FFFFFF",
            }}
          >
            {hookTitle.toUpperCase()}
          </div>
        </div>
      )}

      {/* Spoken Word Animated Captions */}
      {activeGroup && (
        <div style={{ transform: "translateY(120px)" }}>
          <CaptionBox group={activeGroup} frame={frame} theme={theme} />
        </div>
      )}
    </div>
  );
};
