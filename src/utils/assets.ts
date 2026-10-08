import { ensureDir, listFiles } from "./fs";
import { runFfmpeg } from "./ffmpeg";
import { createLogger } from "./logger";
import { join } from "path";

const log = createLogger("assets");

/**
 * Ensures at least one gameplay/satisfying background video is present in the subwaySurfers directory.
 * If none exists, generates a high-quality 60-second animated procedural background video using FFmpeg.
 */
export async function ensureGameplayAssets(
  targetDir: string = "./assets/subway-surfers",
): Promise<string[]> {
  ensureDir(targetDir);
  const existing = listFiles(targetDir, ".mp4");
  if (existing.length > 0) {
    return existing;
  }

  log.info(`Generating sample satisfying gameplay background in ${targetDir}...`);
  const samplePath = join(targetDir, "sample_gameplay_bg.mp4");

  // Create a dynamic 60s colorful background with FFmpeg lavfi
  try {
    await runFfmpeg([
      "-f",
      "lavfi",
      "-i",
      "mandelbrot=size=1080x960:rate=30:maxiter=100",
      "-t",
      "60",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-y",
      samplePath,
    ]);
    log.info(`Sample gameplay asset created: ${samplePath}`);
    return [samplePath];
  } catch (err) {
    log.warn(`Failed to generate procedural background: ${err}`);
    return [];
  }
}
