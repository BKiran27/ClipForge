import { GoogleGenAI } from "@google/genai";
import { createLogger } from "../utils/logger";
import type { Config } from "../config";
import type { Transcript, VideoMetadata, ClipCandidate } from "../pipeline/types";

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

export class ClipIdentifier {
  private ai: GoogleGenAI;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
    this.ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  }

  async identify(transcript: Transcript, metadata: VideoMetadata): Promise<ClipCandidate[]> {
    log.info(`Analyzing transcript for clip-worthy segments...`);

    const formattedTranscript = transcript.segments
      .map((s) => `[${s.start.toFixed(1)}s - ${s.end.toFixed(1)}s] ${s.text}`)
      .join("\n");

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

    if (parsedClips.length === 0 && lastError) {
      throw new Error(`Failed to identify clips via Gemini: ${lastError}`);
    }

    log.info(`Gemini returned ${parsedClips.length} raw clips`);

    // 1. Filter duration & bounds
    const maxDur = metadata.duration > 0 ? metadata.duration : 86400;
    const validClips = parsedClips.filter((c) => {
      const dur = c.endTime - c.startTime;
      if (dur < 15 || dur > 120 || c.startTime < 0 || c.endTime > maxDur + 5) {
        log.debug(
          `Filtered out "${c.title}" (dur=${dur}s, start=${c.startTime}, end=${c.endTime})`,
        );
        return false;
      }
      return true;
    });

    // 2. Sort by viralScore descending
    validClips.sort((a, b) => (b.viralScore || 0) - (a.viralScore || 0));

    // 3. Deduplicate heavily overlapping clips (> 50% overlap)
    const deduplicated: typeof validClips = [];
    for (const clip of validClips) {
      const overlaps = deduplicated.some((existing) => {
        const overlapStart = Math.max(clip.startTime, existing.startTime);
        const overlapEnd = Math.min(clip.endTime, existing.endTime);
        const overlapDuration = Math.max(0, overlapEnd - overlapStart);
        const minLen = Math.min(
          clip.endTime - clip.startTime,
          existing.endTime - existing.startTime,
        );
        return overlapDuration / minLen > 0.5;
      });

      if (!overlaps) {
        deduplicated.push(clip);
      } else {
        log.debug(`Skipped duplicate/overlapping clip: "${clip.title}"`);
      }
    }

    const candidates: ClipCandidate[] = deduplicated.map((c) => ({
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

    log.info(`Identified ${candidates.length} unique viral candidates`);
    return candidates;
  }
}
