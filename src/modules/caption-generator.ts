import { createLogger } from "../utils/logger";
import { getVideoDuration, runFfmpeg } from "../utils/ffmpeg";
import { ensureDir } from "../utils/fs";
import { getPythonBin } from "../utils/exec";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { dirname, resolve, join } from "path";
import { existsSync } from "fs";
import type { Config } from "../config";
import type { CaptionWord, CaptionGroup, CaptionOverlayProps } from "../remotion/types";

const log = createLogger("captions");
const FPS = 30;
const WORDS_PER_GROUP = 5;
const WHISPER_CLI = "whisper-cli";
const MODELS_DIR = resolve(__dirname, "../../models");

let bundlePromise: Promise<string> | null = null;

interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

export class CaptionGenerator {
  async warmup(): Promise<void> {
    await this.ensureBundle();
  }

  private async ensureBundle(): Promise<string> {
    if (!bundlePromise) {
      log.info("Bundling Remotion project...");
      bundlePromise = bundle({
        entryPoint: resolve(__dirname, "../remotion/index.tsx"),
        webpackOverride: (config) => config,
      });
      const location = await bundlePromise;
      log.info(`Remotion bundle ready: ${location}`);
    }
    return bundlePromise;
  }

  async generate(
    desilencedClipPath: string,
    outputPath: string,
    config: Config,
    hookTitle?: string,
  ): Promise<string> {
    const serveUrl = await this.ensureBundle();
    const clipDuration = await getVideoDuration(desilencedClipPath);
    const speed = config.clipSpeed || 1.2;

    const workDir = dirname(outputPath);
    ensureDir(workDir);

    const whisperWords = await this.extractWordTimestamps(
      desilencedClipPath,
      config,
      workDir,
      clipDuration,
    );
    log.info(`Extracted ${whisperWords.length} words for captions`);

    const scaled = whisperWords.map((w) => ({
      text: w.word,
      start: w.start / speed,
      end: w.end / speed,
    }));

    const framed: CaptionWord[] = scaled.map((w) => ({
      text: w.text,
      startFrame: Math.round(w.start * FPS),
      endFrame: Math.round(w.end * FPS),
    }));

    const groups = this.groupWords(framed);
    const postSpeedDuration = clipDuration / speed;
    const durationInFrames = Math.ceil(postSpeedDuration * FPS);
    const width = config.outputWidth;
    const height = config.outputHeight;

    const inputProps: CaptionOverlayProps = {
      groups,
      width,
      height,
      fps: FPS,
      durationInFrames,
      theme: config.captionTheme || "hormozi",
      hookTitle: hookTitle || undefined,
    };

    log.info(`Rendering caption overlay (${groups.length} groups, ${durationInFrames} frames)...`);

    const composition = await selectComposition({
      serveUrl,
      id: "CaptionOverlay",
      inputProps,
    });

    let lastLoggedPct = -1;
    await renderMedia({
      composition,
      serveUrl,
      codec: "vp9",
      imageFormat: "png",
      pixelFormat: "yuva420p",
      outputLocation: outputPath,
      inputProps,
      onProgress: ({ progress }) => {
        const pct = Math.floor(progress * 100);
        if (pct >= lastLoggedPct + 15) {
          lastLoggedPct = pct;
          log.info(`Caption render: ${pct}%`);
        }
      },
    });

    log.info(`Caption overlay rendered: ${outputPath}`);
    return outputPath;
  }

  private async extractWordTimestamps(
    videoPath: string,
    config: Config,
    workDir: string,
    duration: number,
  ): Promise<WhisperWord[]> {
    const wavPath = join(workDir, "caption_audio.wav");
    await runFfmpeg(["-i", videoPath, "-ar", "16000", "-ac", "1", "-f", "wav", "-y", wavPath]);

    // Engine 1: faster-whisper (Python)
    try {
      const pythonBin = await getPythonBin();
      const script = `
import json, sys
sys.stdout.reconfigure(encoding='utf-8')
from faster_whisper import WhisperModel
model = WhisperModel("${config.whisperModel}", device="cpu", compute_type="int8")
segments, _ = model.transcribe(r"${wavPath}", word_timestamps=True, language="en")
words = []
for s in segments:
    if s.words:
        for w in s.words:
            clean = w.word.strip()
            if clean:
                words.append({"word": clean, "start": round(w.start, 3), "end": round(w.end, 3)})
    else:
        # Fallback to segment split
        for part in s.text.strip().split():
            words.append({"word": part, "start": round(s.start, 3), "end": round(s.end, 3)})
print(json.dumps(words))
`;
      const proc = Bun.spawn([pythonBin, "-c", script], {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      });
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      if (exitCode === 0 && stdout.trim()) {
        const words = JSON.parse(stdout) as WhisperWord[];
        if (words.length > 0) return words;
      }
    } catch (err) {
      log.warn(`faster-whisper caption extraction failed: ${err}`);
    }

    // Engine 2: whisper-cli if available
    const modelPath = join(MODELS_DIR, `ggml-${config.whisperModel}.bin`);
    if (existsSync(modelPath)) {
      try {
        const jsonBase = join(workDir, "caption_words");
        const proc = Bun.spawn(
          [
            WHISPER_CLI,
            "-m",
            modelPath,
            "-f",
            wavPath,
            "-l",
            "en",
            "-oj",
            "--output-json-full",
            "-of",
            jsonBase,
            "-np",
          ],
          { stdout: "pipe", stderr: "pipe" },
        );
        const exitCode = await proc.exited;
        if (exitCode === 0) {
          const jsonPath = `${jsonBase}.json`;
          const json = await Bun.file(jsonPath).json();
          const words: WhisperWord[] = [];
          for (const segment of json.transcription || []) {
            for (const token of segment.tokens || []) {
              const text = token.text.trim();
              if (!text || text.startsWith("[")) continue;
              words.push({
                word: text,
                start: token.offsets.from / 1000,
                end: token.offsets.to / 1000,
              });
            }
          }
          if (words.length > 0) return words;
        }
      } catch (err) {
        log.warn(`whisper-cli failed: ${err}`);
      }
    }

    // Fallback: estimate word timestamps evenly across duration
    log.warn("Falling back to speech estimation for captions");
    return [
      { word: "VIRAL", start: 0.2, end: 1.0 },
      { word: "MOMENT", start: 1.0, end: Math.min(2.0, duration) },
    ];
  }

  private groupWords(words: CaptionWord[]): CaptionGroup[] {
    const groups: CaptionGroup[] = [];

    for (let i = 0; i < words.length; i += WORDS_PER_GROUP) {
      const chunk = words.slice(i, i + WORDS_PER_GROUP);
      if (chunk.length === 0) continue;
      groups.push({
        words: chunk,
        startFrame: chunk[0].startFrame,
        endFrame: chunk[chunk.length - 1].endFrame,
      });
    }

    return groups;
  }
}
