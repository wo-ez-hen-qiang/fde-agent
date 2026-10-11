import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function runCommand(
  command: string,
  args: string[],
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(command, args, {
      timeout: 8_000,
      maxBuffer: 1024 * 1024,
      env: process.env,
    });
    return { ok: true, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
  } catch (error) {
    const detail = error as { stdout?: string; stderr?: string };
    return {
      ok: false,
      stdout: detail.stdout?.trim() ?? "",
      stderr: detail.stderr?.trim() ?? "",
    };
  }
}

export function backendTimeoutMs(): number {
  const value = Number(process.env.FDE_CLI_TIMEOUT_MS ?? "120000");
  return Number.isFinite(value) && value > 0 ? value : 120_000;
}
