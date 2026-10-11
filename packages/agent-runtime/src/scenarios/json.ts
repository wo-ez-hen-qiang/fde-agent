import type { z } from "zod";

/**
 * 从模型输出里抠出 JSON 对象。
 *
 * 为什么需要：codex 路径没有可靠的结构化通道，只能从句子里解析 JSON，
 * 模型多说一句话就整轮失败。这里做「去围栏 → 直接 parse → 花括号配平扫描」三级降级，
 * 比单纯 stripFences + JSON.parse 稳得多。
 */

/** 去掉 ```json … ``` 围栏（若有）。 */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/m.exec(trimmed);
  return fence?.[1]?.trim() ?? trimmed;
}

/**
 * 从第一个 `{` 起做字符串感知的花括号配平扫描，返回第一个平衡的子串。
 * 会跳过字符串字面量内的花括号与转义字符。
 */
function balancedObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i] ?? "";
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** 解析 JSON 对象；全部失败时抛结构化错误（带片段便于定位）。 */
export function extractJsonObject(raw: unknown): unknown {
  if (typeof raw === "object" && raw !== null) return raw;
  const text = String(raw ?? "");
  const candidates = [stripFences(text), balancedObject(text)].filter(
    (candidate): candidate is string => Boolean(candidate),
  );

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      /* 试下一个 */
    }
  }
  throw new Error(`模型输出不是合法 JSON（前 200 字符）：${text.trim().slice(0, 200)}`);
}

/**
 * 用 zod 校验结构化输出，失败时给出**可诊断**的错误：
 * 带上模型实际返回的字段名与缺失字段，而不是 zod 的原始 issue 数组。
 * （模型的字段名漂移是最常见的失败，错误里直接体现才查得动。）
 */
export function validateStructured<T>(schema: z.ZodType<T>, raw: unknown, label: string): T {
  const candidate = extractJsonObject(raw);
  const parsed = schema.safeParse(candidate);
  if (parsed.success) return parsed.data;

  const received =
    typeof candidate === "object" && candidate !== null
      ? Object.keys(candidate as Record<string, unknown>).join(", ") || "（空对象）"
      : `非对象（${typeof candidate}）`;
  const problems = parsed.error.issues
    .map((issue) => issue.path.join("."))
    .filter(Boolean)
    .slice(0, 6)
    .join("、");
  throw new Error(
    `${label}：结构化输出字段不符合约定。收到字段 [${received}]；问题字段 [${problems}]。`,
  );
}
