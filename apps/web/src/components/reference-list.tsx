"use client";

import type { DiagnosisReference } from "@fde/shared";

/** 参考资料列表：列出条目（标题/相关度/摘要），而不是只给一个条数。 */
export function ReferenceList({ references }: { references: DiagnosisReference[] }) {
  if (references.length === 0) {
    return <p className="text-xs text-secondary">知识库没有找到相关依据</p>;
  }
  return (
    <details className="mt-1" open>
      <summary className="cursor-pointer text-xs text-secondary">
        参考资料（{references.length} 条）
      </summary>
      <ol className="mt-2 space-y-2">
        {references.map((reference, index) => (
          <li key={reference.chunkId || `${reference.documentId}-${index}`} className="text-xs">
            <span className="text-ink">
              [{index + 1}] {reference.documentTitle}
            </span>
            <span className="ml-2 text-secondary">{reference.score.toFixed(2)}</span>
            <p className="mt-0.5 whitespace-pre-wrap text-secondary">
              {reference.excerpt.replace(/\s+/g, " ").slice(0, 200)}
            </p>
          </li>
        ))}
      </ol>
    </details>
  );
}
