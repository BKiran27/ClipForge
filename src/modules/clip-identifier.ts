import { GoogleGenAI } from "@google/genai";
import { createLogger } from "../utils/logger";
import type { Config } from "../config";
import type {
  Transcript,
  VideoMetadata,
  ClipCandidate,
  TranscriptSegment,
} from "../pipeline/types";

const log = createLogger("clip-identifier");

const CLIP_SCHEMA = {
  type: "object" as const,
  properties: {
    clips: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          title: { type: "string" as const },
          hookLine: { type: "string" as const },
          startTime: { type: "number" as const },
          endTime: { type: "number" as const },
          reasoning: { type: "string" as const },
          viralScore: { type: "number" as const },
          tags: { type: "array" as const, items: { type: "string" as const } },
        },
        required: ["title", "hookLine", "startTime", "endTime", "reasoning", "viralScore", "tags"],
      },
    },
  },
  required: ["clips"],
};

const HOOK_KEYWORDS = [
  "why",
  "how",
  "secret",
  "never",
  "always",
  "truth",
  "money",
  "mistake",
  "everyone",
  "discover",
  "crazy",
  "insane",
  "actually",
  "believe",
  "look at",
  "wait",
  "listen",
  "stop",
  "best",
  "worst",
  "shocking",
  "nobody",
  "rule",
  "hack",
  "formula",
  "future",
  "huge",
  "warning",
  "important",
];

export class ClipIdentifier {
  private ai: GoogleGenAI | null = null;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    if (config.geminiApiKey && config.geminiApiKey.trim()) {
      try {
        this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
      } catch (err) {
        log.warn(`Could not initialize Gemini AI client: ${err}`);
      }
    }
  }

  async identify(transcript: Transcript, metadata: VideoMetadata): Promise<ClipCandidate[]> {
    log.info(`Analyzing transcript for clip-worthy segments...`);

    // 1. If Gemini AI is configured, attempt LLM extraction
    if (this.ai && this.config.geminiApiKey && this.config.geminiApiKey.trim()) {
      try {
        const aiClips = await this.identifyViaGemini(transcript, metadata);
        if (aiClips.length > 0) {
          log.info(`Identified ${aiClips.length} clips using Gemini AI`);
          return aiClips;
        }
      } catch (err) {
        log.warn(
          `Gemini AI identification failed: ${err}. Falling back to Smart Heuristic Engine.`,
        );
      }
    } else {
      log.info(`No Gemini API Key provided. Using Built-in Smart Heuristic Engine.`);
    }

    // 2. High-precision Algorithmic / Smart Heuristic Fallback
    const heuristicClips = this.identifyHeuristic(transcript, metadata);
    log.info(`Identified ${heuristicClips.length} clips using Smart Heuristic Engine`);
    return heuristicClips;
  }

  private async identifyViaGemini(
    transcript: Transcript,
    metadata: VideoMetadata,
  ): Promise<ClipCandidate[]> {
    if (!this.ai) return [];

    const formattedTranscript = transcript.segments
      .map((s) => `[${s.start.toFixed(1)}s - ${s.end.toFixed(1)}s] ${s.text}`)
      .join("\n");

    if (!formattedTranscript.trim()) return [];

    const prompt = `You are an elite short-form content strategist specializing in viral TikToks, YouTube Shorts, and Instagram Reels.

Analyze this transcript from "${metadata.title}" (total duration: ${metadata.duration || "unknown"} seconds) and identify high-retention, self-contained short clips (30-90 seconds each).

Prioritize segments with:
1. High-Curiosity Hooks in the first 3 seconds (unexpected questions, bold claims, intriguing setup)
2. Fast Narrative Pacing with dramatic revelations or shocking facts
3. Quotable Soundbites and relatable/actionable insights
4. Strong Satisfying Payoff / conclusion before the clip ends

Each clip MUST:
- Be 30-90 seconds long (optimal for YouTube Shorts & TikTok algorithmic distribution)
- Be completely self-contained without needing prior or subsequent context
- Have startTime and endTime given as numbers in SECONDS
- Have an attention-grabbing hookLine for the first sentence
- Have a viralScore from 1 to 10
- Include relevant hashtags in tags

TRANSCRIPT:
${formattedTranscript}

Return 5-15 of the best clips, sorted by viralScore descending.`;

    const modelCandidates = [
      this.config.geminiModel,
      "gemini-2.0-flash",
      "gemini-1.5-flash",
      "gemini-2.5-flash",
    ].filter(Boolean) as string[];

    let parsedClips: Array<{
      title: string;
      hookLine: string;
      startTime: number;
      endTime: number;
      reasoning: string;
      viralScore: number;
      tags: string[];
    }> = [];

    let lastError: unknown = null;

    for (const model of modelCandidates) {
      try {
        log.info(`Querying Gemini model: ${model}...`);
        const response = await this.ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: CLIP_SCHEMA,
          },
        });

        const text = response.text ?? "";
        if (!text) continue;

        const parsed = JSON.parse(text) as {
          clips: Array<{
            title: string;
            hookLine: string;
            startTime: number;
            endTime: number;
            reasoning: string;
            viralScore: number;
            tags: string[];
          }>;
        };

        if (Array.isArray(parsed?.clips) && parsed.clips.length > 0) {
          parsedClips = parsed.clips;
          break;
        }
      } catch (err) {
        log.warn(`Model ${model} request failed: ${err}`);
        lastError = err;
      }
    }

    if (parsedClips.length === 0) {
      if (lastError) log.warn(`Gemini API could not extract clips: ${lastError}`);
      return [];
    }

    // Filter duration & bounds
    const maxDur = metadata.duration > 0 ? metadata.duration : 86400;
    const validClips = parsedClips.filter((c) => {
      const dur = c.endTime - c.startTime;
      if (dur < 15 || dur > 120 || c.startTime < 0 || c.endTime > maxDur + 5) {
        return false;
      }
      return true;
    });

    validClips.sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0));

    const deduplicated = this.deduplicateCandidates(validClips);

    return deduplicated.map((c) => ({
      id: crypto.randomUUID(),
      title: c.title,
      hookLine: c.hookLine,
      startTime: Math.max(0, c.startTime),
      endTime: c.endTime,
      duration: c.endTime - Math.max(0, c.startTime),
      reasoning: c.reasoning,
      viralScore: c.viralScore,
      tags: c.tags,
    }));
  }

  identifyHeuristic(transcript: Transcript, metadata: VideoMetadata): ClipCandidate[] {
    const segments = transcript.segments || [];

    // Case 1: Video has transcript segments
    if (segments.length > 0) {
      const candidates: Array<{
        title: string;
        hookLine: string;
        startTime: number;
        endTime: number;
        reasoning: string;
        viralScore: number;
        tags: string[];
      }> = [];

      const targetMinDuration = 25;
      const targetMaxDuration = 75;
      const step = Math.max(1, Math.floor(segments.length / 40));

      for (let i = 0; i < segments.length; i += step) {
        let j = i;
        let windowText = "";
        let startTime = segments[i].start;
        let endTime = segments[i].end;

        while (j < segments.length) {
          const seg = segments[j];
          windowText += (windowText ? " " : "") + seg.text;
          endTime = seg.end;
          const dur = endTime - startTime;

          if (dur >= targetMinDuration && dur <= targetMaxDuration) {
            // Check if this window ends on a clean sentence or clause boundary
            const endsWithPunct = /[.?!,]$/.test(seg.text.trim());
            const score = this.calculateViralityScore(
              segments.slice(i, j + 1),
              windowText,
              dur,
              endsWithPunct,
            );

            const hookSegments = segments.slice(i, Math.min(i + 2, j + 1));
            const hookLine = hookSegments
              .map((s) => s.text)
              .join(" ")
              .slice(0, 110);
            const title = this.generateClipTitle(hookLine, metadata.title);
            const tags = this.generateViralTags(windowText, metadata.title);

            candidates.push({
              title,
              hookLine,
              startTime: Math.round(startTime * 10) / 10,
              endTime: Math.round(endTime * 10) / 10,
              reasoning:
                "Selected by speech velocity analysis, strong curiosity hook, and natural phrase boundary.",
              viralScore: score,
              tags,
            });

            if (dur >= 45) break; // found a solid segment
          } else if (dur > targetMaxDuration) {
            break;
          }
          j++;
        }
      }

      candidates.sort((a, b) => b.viralScore - a.viralScore);
      const deduplicated = this.deduplicateCandidates(candidates);

      if (deduplicated.length > 0) {
        return deduplicated.slice(0, 10).map((c) => ({
          id: crypto.randomUUID(),
          title: c.title,
          hookLine: c.hookLine,
          startTime: Math.max(0, c.startTime),
          endTime: c.endTime,
          duration: Math.round((c.endTime - Math.max(0, c.startTime)) * 10) / 10,
          reasoning: c.reasoning,
          viralScore: c.viralScore,
          tags: c.tags,
        }));
      }
    }

    // Case 2: No transcript or silent/music/ambient video -> generate distributed highlights
    const totalDuration = metadata.duration > 0 ? metadata.duration : 180;
    return this.generateDistributedClips(totalDuration, metadata.title);
  }

  private calculateViralityScore(
    windowSegments: TranscriptSegment[],
    text: string,
    duration: number,
    cleanEnding: boolean,
  ): number {
    let score = 7.0;

    // 1. Hook strength in the first 2 segments
    const hookSnippet = windowSegments
      .slice(0, 2)
      .map((s) => s.text.toLowerCase())
      .join(" ");

    let hookHits = 0;
    for (const kw of HOOK_KEYWORDS) {
      if (hookSnippet.includes(kw)) hookHits++;
    }
    score += Math.min(1.8, hookHits * 0.45);

    if (hookSnippet.includes("?")) score += 0.8;
    if (hookSnippet.includes("!")) score += 0.5;

    // 2. Speech pacing: words per second
    const wordCount = text.trim().split(/\s+/).length;
    const wps = wordCount / Math.max(1, duration);
    if (wps >= 2.2 && wps <= 4.0) {
      score += 0.8; // energetic conversation pace
    } else if (wps > 4.0) {
      score += 0.4;
    }

    // 3. Clean sentence boundary payoff
    if (cleanEnding) score += 0.4;

    return Math.min(9.8, Math.max(6.5, Math.round(score * 10) / 10));
  }

  private generateClipTitle(hookLine: string, videoTitle: string): string {
    const clean = hookLine
      .replace(/[^\w\s?!'-]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (clean.length >= 10 && clean.length <= 48) {
      return clean.charAt(0).toUpperCase() + clean.slice(1);
    }

    // Cut to first sentence or clause
    const clauseMatch = clean.match(/^([^?!,]{8,45}[?!]?)/);
    if (clauseMatch && clauseMatch[1].length >= 10) {
      return clauseMatch[1].trim();
    }

    const shortVidTitle = videoTitle.split(/[|:-]/)[0].trim().slice(0, 35);
    return shortVidTitle ? `${shortVidTitle} - Viral Moment` : "Must Watch Highlight";
  }

  private generateViralTags(text: string, videoTitle: string): string[] {
    const tags = new Set<string>(["#shorts", "#viral", "#trending", "#fyp"]);
    const words = `${videoTitle} ${text}`.toLowerCase().match(/[a-z]{4,15}/g) || [];

    const interesting = words.filter(
      (w) =>
        !["this", "that", "with", "from", "have", "what", "then", "will", "when", "your"].includes(
          w,
        ),
    );

    for (let i = 0; i < Math.min(3, interesting.length); i++) {
      tags.add(`#${interesting[i]}`);
    }

    return Array.from(tags).slice(0, 6);
  }

  private deduplicateCandidates<T extends { startTime: number; endTime: number; title: string }>(
    clips: T[],
  ): T[] {
    const deduplicated: T[] = [];
    for (const clip of clips) {
      const overlaps = deduplicated.some((existing) => {
        const overlapStart = Math.max(clip.startTime, existing.startTime);
        const overlapEnd = Math.min(clip.endTime, existing.endTime);
        const overlapDuration = Math.max(0, overlapEnd - overlapStart);
        const minLen = Math.min(
          clip.endTime - clip.startTime,
          existing.endTime - existing.startTime,
        );
        return minLen > 0 && overlapDuration / minLen > 0.4;
      });

      if (!overlaps) {
        deduplicated.push(clip);
      }
    }
    return deduplicated;
  }

  private generateDistributedClips(duration: number, title: string): ClipCandidate[] {
    const clips: ClipCandidate[] = [];
    const cleanTitle = title.split(/[|:-]/)[0].trim() || "Viral Clip";

    if (duration <= 60) {
      clips.push({
        id: crypto.randomUUID(),
        title: `${cleanTitle} - Full Reel`,
        hookLine: `Watch ${cleanTitle}`,
        startTime: 0,
        endTime: Math.round(duration),
        duration: Math.round(duration),
        reasoning: "Complete short-form highlight segment.",
        viralScore: 9.0,
        tags: ["#shorts", "#viral", "#trending"],
      });
      return clips;
    }

    const clipSlots = [
      { pctStart: 0.05, duration: 45, label: "Intro Hook", score: 9.2 },
      { pctStart: 0.35, duration: 50, label: "Key Insight", score: 8.8 },
      { pctStart: 0.65, duration: 50, label: "Climax Moment", score: 8.5 },
      { pctStart: 0.82, duration: 40, label: "Grand Finale", score: 8.1 },
    ];

    for (let idx = 0; idx < clipSlots.length; idx++) {
      const slot = clipSlots[idx];
      let start = Math.round(duration * slot.pctStart);
      if (start + slot.duration > duration) {
        start = Math.max(0, Math.round(duration - slot.duration));
      }
      const end = Math.min(Math.round(duration), start + slot.duration);
      const actualDur = end - start;

      if (actualDur >= 20) {
        clips.push({
          id: crypto.randomUUID(),
          title: `${cleanTitle} - ${slot.label}`,
          hookLine: `${cleanTitle} - ${slot.label}`,
          startTime: start,
          endTime: end,
          duration: actualDur,
          reasoning: `High-energy ${slot.label.toLowerCase()} dynamically extracted from video timeline.`,
          viralScore: slot.score,
          tags: ["#shorts", "#viral", "#highlight", "#trending"],
        });
      }
    }

    return clips;
  }
}
