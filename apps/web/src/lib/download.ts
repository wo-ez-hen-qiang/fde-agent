"use client";

/** 把文本作为文件下载（零依赖，浏览器原生 Blob）。 */
export function downloadText(filename: string, text: string, mimeType = "text/markdown"): void {
  const blob = new Blob([text], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** 文件名：售前方案-<场景摘要>-YYYYMMDD-HHmm.md（清洗掉文件系统不接受的字形）。 */
export function presalesFileName(summary: string, createdAt: number): string {
  const date = new Date(createdAt);
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  const slug = summary.replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 24) || "方案";
  return `售前方案-${slug}-${stamp}.md`;
}
