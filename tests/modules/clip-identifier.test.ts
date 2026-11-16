import { describe, test, expect } from "bun:test";
import { ClipIdentifier } from "../../src/modules/clip-identifier";
import { loadConfig } from "../../src/config";
import type { Transcript, VideoMetadata } from "../../src/pipeline/types";

describe("ClipIdentifier", () => {
  const config = loadConfig({ geminiApiKey: "" });
  const identifier = new ClipIdentifier(config);

  const mockMetadata: VideoMetadata = {
    videoId: "test_vid",
    title: "Why Most People Fail at Building Habits - The Secret Truth",
    duration: 300,
    uploadDate: "2026-01-01",
    filePath: "/tmp/fake.mp4",
  };

  test("identifies clips from transcript segments using smart heuristic", async () => {
    const transcript: Transcript = {
      source: "youtube",
      language: "en",
      srtPath: "/tmp/fake.srt",
      fullText:
        "Why do most people fail? Here is the secret truth. You think motivation is everything, but actually consistency is the only rule that works. Stop waiting for the perfect day. Never let a single mistake stop your progress. Everyone wants results, but few respect the daily routine.",
      segments: [
        { text: "Why do most people fail?", start: 0, end: 4, duration: 4 },
        { text: "Here is the secret truth.", start: 4, end: 8, duration: 4 },
        {
          text: "You think motivation is everything,",
          start: 8,
          end: 14,
          duration: 6,
        },
        {
          text: "but actually consistency is the only rule that works.",
          start: 14,
          end: 22,
          duration: 8,
        },
        { text: "Stop waiting for the perfect day.", start: 22, end: 28, duration: 6 },
        {
          text: "Never let a single mistake stop your progress.",
          start: 28,
          end: 36,
          duration: 8,
        },
        {
          text: "Everyone wants results, but few respect the daily routine.",
          start: 36,
          end: 46,
          duration: 10,
        },
      ],
    };

    const clips = await identifier.identify(transcript, mockMetadata);
    expect(clips.length).toBeGreaterThan(0);

    const first = clips[0];
    expect(first.title).toBeDefined();
    expect(first.hookLine).toBeDefined();
    expect(first.viralScore).toBeGreaterThanOrEqual(7);
    expect(first.duration).toBeGreaterThanOrEqual(20);
    expect(first.tags.length).toBeGreaterThan(0);
  });

  test("generates distributed highlight clips when transcript is empty (music / ambient)", async () => {
    const emptyTranscript: Transcript = {
      source: "ambient",
      language: "en",
      srtPath: null,
      fullText: "",
      segments: [],
    };

    const clips = await identifier.identify(emptyTranscript, mockMetadata);
    expect(clips.length).toBeGreaterThanOrEqual(3);

    for (const c of clips) {
      expect(c.duration).toBeGreaterThan(15);
      expect(c.title).toContain(mockMetadata.title.split("-")[0].trim());
      expect(c.viralScore).toBeGreaterThan(7);
    }
  });

  test("generates full reel clip for very short videos without transcript", async () => {
    const shortMeta: VideoMetadata = {
      videoId: "short_vid",
      title: "Epic Dance Move",
      duration: 42,
      uploadDate: "2026-01-01",
      filePath: "/tmp/fake.mp4",
    };

    const emptyTranscript: Transcript = {
      source: "ambient",
      language: "en",
      srtPath: null,
      fullText: "",
      segments: [],
    };

    const clips = await identifier.identify(emptyTranscript, shortMeta);
    expect(clips.length).toBe(1);
    expect(clips[0].duration).toBe(42);
    expect(clips[0].startTime).toBe(0);
    expect(clips[0].endTime).toBe(42);
  });
});
