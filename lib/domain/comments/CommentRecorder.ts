import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

export type RecordedComment = {
  who: string;
  comment: string;
  at: string;
  no?: number;
  hasGift?: boolean;
  isOwner?: boolean;
};

export type RecordCommentOptions = {
  /** テスト用。未指定時は var/comments */
  baseDir?: string;
};

/** 番組キーをファイル名として安全な文字列にする */
export function sanitizeProgramKey(programKey: string): string {
  return programKey.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** 匿名は "anonymous" にまとめ、それ以外は name → userId → "unknown" */
export function resolveCommentWho(data: {
  anonymity: boolean;
  name?: string;
  userId?: string;
}): string {
  if (data.anonymity) return "anonymous";
  const name = data.name?.trim();
  if (name) return name;
  if (data.userId) return data.userId;
  return "unknown";
}

/**
 * 番組ごとにコメントを JSONL で追記する。
 * - 保存先: var/comments/<program-key>.jsonl（または options.baseDir）
 * - システムコメント (userId === "onecomme.system") は記録しない
 * - programKey が無い / 空コメントは何もしない
 */
export async function recordComment(
  programKey: string | null | undefined,
  data: {
    comment: string;
    anonymity: boolean;
    name?: string;
    userId?: string;
    no?: number;
    hasGift?: boolean;
    isOwner?: boolean;
  },
  options?: RecordCommentOptions,
): Promise<void> {
  if (!programKey) return;
  if (data.userId === "onecomme.system") return;

  const comment = data.comment.normalize("NFC").trim();
  if (!comment) return;

  const entry: RecordedComment = {
    who: resolveCommentWho(data),
    comment,
    at: new Date().toISOString(),
    no: data.no,
    hasGift: data.hasGift,
    isOwner: data.isOwner,
  };

  const baseDir = options?.baseDir ?? join("var", "comments");
  const path = join(baseDir, `${sanitizeProgramKey(programKey)}.jsonl`);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
}
