import { createLogger } from "../utils/logger";
import { secondsToSrtTimestamp } from "../utils/ffmpeg";
import { getPythonBin, getYtDlpCommand } from "../utils/exec";
import { ensureDir, listFiles } from "../utils/fs";
import type { Config } from "../config";
import type { TranscriptSegment, Transcript, VideoMetadata } from "../pipeline/types";
import { join } from "path";

const log = createLogger("transcriber");

export class Transcriber {
  async transcribe(
    metadata: VideoMetadata,
    outputDir: string,
    config: Config,
  ): Promise<Transcript> {
    ensureDir(outputDir);

    if (config.preferYouTubeTranscripts) {
      try {
        log.info("Attempting YouTube transcript fetch...");
        return await this.fromYouTube(metadata, outputDir);
      } catch (err) {
        log.warn(`YouTube transcript unavailable: ${err}. Falling back to Whisper.`);
      }
    }

    return await this.fromWhisper(metadata, outputDir, config);
  }

  async fromYouTube(metadata: VideoMetadata, outputDir: string): Promise<Transcript> {
    const pythonBin = await getPythonBin();

    // Strategy 1: youtube-transcript-api in python
    const script = `
import json, sys
sys.stdout.reconfigure(encoding='utf-8')
from youtube_transcript_api import YouTubeTranscriptApi
video_id = sys.argv[1]
try:
    ytt = YouTubeTranscriptApi()
    fetched = ytt.fetch(video_id)
    snippets = [{"text": s.text, "start": s.start, "duration": s.duration} for s in fetched.snippets]
    print(json.dumps(snippets))
except Exception as e:
    try:
        # Fallback to get_transcript static method
        raw = YouTubeTranscriptApi.get_transcript(video_id, languages=['en', 'en-US', 'en-GB'])
        snippets = [{"text": s["text"], "start": s["start"], "duration": s["duration"]} for s in raw]
        print(json.dumps(snippets))
    except Exception as e2:
        sys.stderr.write(f"API Error: {e} | {e2}\\n")
        sys.exit(1)
`;

    try {
      const proc = Bun.spawn([pythonBin, "-c", script, metadata.videoId], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      if (exitCode === 0 && stdout.trim()) {
        const raw = JSON.parse(stdout) as Array<{ text: string; start: number; duration: number }>;
        if (raw.length > 0) {
          return await this.buildTranscriptFromSegments("youtube", raw, outputDir);
        }
      } else {
        log.warn(`youtube-transcript-api returned non-zero (${exitCode}): ${stderr.trim()}`);
      }
    } catch (err) {
      log.warn(`youtube-transcript-api failed: ${err}`);
    }

    // Strategy 2: yt-dlp subtitle download (handles IpBlocked by bypassing direct API)
    log.info("Attempting yt-dlp subtitle extraction fallback...");
    const ytTranscript = await this.fromYtDlpSubtitles(metadata, outputDir);
    if (ytTranscript) {
      return ytTranscript;
    }

    throw new Error("Could not retrieve YouTube captions from API or yt-dlp");
  }

  private async fromYtDlpSubtitles(
    metadata: VideoMetadata,
    outputDir: string,
  ): Promise<Transcript | null> {
    const ytCmd = await getYtDlpCommand();
    const subPrefix = join(outputDir, "sub");

    const proc = Bun.spawn(
      [
        ...ytCmd,
        "--write-auto-sub",
        "--write-subs",
        "--sub-lang",
        "en.*,en",
        "--skip-download",
        "--sub-format",
        "vtt/srv1/json3",
        "-o",
        subPrefix,
        `https://www.youtube.com/watch?v=${metadata.videoId}`,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    await proc.exited;

    // Look for generated vtt files
    const vttFiles = listFiles(outputDir, ".vtt");
    if (vttFiles.length === 0) return null;

    const vttContent = await Bun.file(vttFiles[0]).text();
    const segments = this.parseVtt(vttContent);
    if (segments.length === 0) return null;

    return await this.buildTranscriptFromSegments("youtube", segments, outputDir);
  }

  async fromWhisper(
    metadata: VideoMetadata,
    outputDir: string,
    config: Config,
  ): Promise<Transcript> {
    log.info(`Running Whisper transcription (model: ${config.whisperModel})...`);
    const pythonBin = await getPythonBin();

    // Strategy 1: faster-whisper (high speed CTranslate2)
    const fasterScript = `
import json, sys
sys.stdout.reconfigure(encoding='utf-8')
from faster_whisper import WhisperModel
model_name = sys.argv[1]
audio_path = sys.argv[2]
model = WhisperModel(model_name, device="cpu", compute_type="int8")
segments_gen, info = model.transcribe(audio_path, language="en")
out = []
for s in segments_gen:
    out.append({"text": s.text.strip(), "start": s.start, "end": s.end, "duration": s.end - s.start})
print(json.dumps(out))
`;

    try {
      const proc = Bun.spawn(
        [pythonBin, "-c", fasterScript, config.whisperModel, metadata.filePath],
        {
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        },
      );
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      if (exitCode === 0 && stdout.trim()) {
        const raw = JSON.parse(stdout) as Array<{
          text: string;
          start: number;
          end: number;
          duration: number;
        }>;
        return await this.buildTranscriptFromSegments("whisper", raw, outputDir);
      }
    } catch (err) {
      log.warn(`faster-whisper failed: ${err}`);
    }

    // Strategy 2: standard openai-whisper
    const whisperScript = `
import whisper, json, sys
sys.stdout.reconfigure(encoding='utf-8')
model_name = sys.argv[1]
audio_path = sys.argv[2]
model = whisper.load_model(model_name)
result = model.transcribe(audio_path, language="en")
segments = [{"text": s["text"].strip(), "start": s["start"], "end": s["end"], "duration": s["end"] - s["start"]} for s in result["segments"]]
print(json.dumps(segments))
`;

    const proc = Bun.spawn(
      [pythonBin, "-c", whisperScript, config.whisperModel, metadata.filePath],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      },
    );
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) throw new Error(`Whisper transcription failed: ${stderr}`);

    const raw = JSON.parse(stdout) as Array<{
      text: string;
      start: number;
      end: number;
      duration: number;
    }>;
    return await this.buildTranscriptFromSegments("whisper", raw, outputDir);
  }

  private async buildTranscriptFromSegments(
    source: "whisper" | "youtube" | "deepgram",
    raw: Array<{ text: string; start: number; duration?: number; end?: number }>,
    outputDir: string,
  ): Promise<Transcript> {
    const segments: TranscriptSegment[] = raw
      .map((s) => ({
        text: s.text.replace(/<[^>]+>/g, "").trim(),
        start: s.start,
        duration: s.duration ?? (s.end ? s.end - s.start : 2),
        end: s.end ?? s.start + (s.duration ?? 2),
      }))
      .filter((s) => s.text.length > 0);

    const fullText = segments.map((s) => s.text).join(" ");
    const srtPath = join(outputDir, "transcript.srt");
    await this.writeSrt(segments, srtPath);

    log.info(`${source.toUpperCase()} transcript: ${segments.length} segments`);
    return { source, language: "en", segments, fullText, srtPath };
  }

  parseVtt(vtt: string): Array<{ text: string; start: number; end: number; duration: number }> {
    const lines = vtt.split(/\r?\n/);
    const results: Array<{ text: string; start: number; end: number; duration: number }> = [];

    const timeRegex = /((?:\d{2}:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d{2}:)?\d{2}:\d{2}\.\d{3})/;

    let currentStart = 0;
    let currentEnd = 0;
    let textBuffer: string[] = [];

    const parseSeconds = (ts: string): number => {
      const parts = ts.split(":");
      if (parts.length === 3) {
        return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
      }
      return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
    };

    for (const line of lines) {
      const trimmed = line.trim();
      const match = trimmed.match(timeRegex);

      if (match) {
        if (textBuffer.length > 0 && currentEnd > currentStart) {
          const text = textBuffer
            .join(" ")
            .replace(/<[^>]+>/g, "")
            .trim();
          if (text) {
            results.push({
              text,
              start: currentStart,
              end: currentEnd,
              duration: currentEnd - currentStart,
            });
          }
          textBuffer = [];
        }
        currentStart = parseSeconds(match[1]);
        currentEnd = parseSeconds(match[2]);
      } else if (
        trimmed &&
        !trimmed.startsWith("WEBVTT") &&
        !trimmed.startsWith("NOTE") &&
        !/^\d+$/.test(trimmed)
      ) {
        textBuffer.push(trimmed);
      }
    }

    if (textBuffer.length > 0 && currentEnd > currentStart) {
      const text = textBuffer
        .join(" ")
        .replace(/<[^>]+>/g, "")
        .trim();
      if (text) {
        results.push({
          text,
          start: currentStart,
          end: currentEnd,
          duration: currentEnd - currentStart,
        });
      }
    }

    return results;
  }

  async writeSrt(segments: TranscriptSegment[], outputPath: string): Promise<void> {
    const lines: string[] = [];
    segments.forEach((seg, i) => {
      lines.push(String(i + 1));
      lines.push(`${secondsToSrtTimestamp(seg.start)} --> ${secondsToSrtTimestamp(seg.end)}`);
      lines.push(seg.text);
      lines.push("");
    });
    await Bun.write(outputPath, lines.join("\n"));
  }
}
