import type { FullOutputMode, FullTask } from "../../../contracts/backend.js";

export interface PDFSource {
  attachment: Zotero.Item;
  parentItem?: Zotero.Item;
  path: string;
  filename: string;
  bytes: Uint8Array;
  fileHash: string;
}

function toBytes(value: unknown): Uint8Array {
  if (typeof value === "string") {
    const bytes = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
      bytes[index] = value.charCodeAt(index) & 0xff;
    }
    return bytes;
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error("Zotero returned an unsupported file data format");
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const data = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(data).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || "source.pdf";
}

async function resolveAttachment(item: Zotero.Item): Promise<{
  attachment: Zotero.Item;
  parentItem?: Zotero.Item;
}> {
  if (item.isPDFAttachment()) {
    const parent = typeof item.parentItemID === "number"
      ? item.parentItem ?? undefined
      : undefined;
    return { attachment: item, parentItem: parent };
  }
  const candidates = await item.getBestAttachments();
  const attachment = candidates.find((candidate) => candidate.isPDFAttachment());
  if (!attachment) {
    throw new Error("所选条目没有可用的 PDF 附件");
  }
  return { attachment, parentItem: item };
}

export async function readPDFSource(item: Zotero.Item): Promise<PDFSource> {
  const { attachment, parentItem } = await resolveAttachment(item);
  const path = await attachment.getFilePathAsync();
  if (!path) {
    throw new Error("PDF 附件文件不存在或无法读取");
  }
  const bytes = toBytes(await IOUtils.read(path));
  if (bytes.length < 5 || new TextDecoder("ascii").decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new Error("所选文件不是有效的 PDF");
  }
  return {
    attachment,
    parentItem,
    path,
    filename: attachment.attachmentFilename || basename(path),
    bytes,
    fileHash: await sha256(bytes),
  };
}

function outputModeLabel(outputMode: FullOutputMode): string {
  return outputMode === "bilingual" ? "bilingual" : "translated";
}

export function translatedAttachmentTitle(
  source: PDFSource,
  targetLanguage: string,
  outputMode: FullOutputMode,
  engine = "pdf2zh_next",
): string {
  const filename = source.filename.replace(/\.pdf$/i, "");
  return `${filename} [ZUT ${targetLanguage} ${outputModeLabel(outputMode)} ${engine} ${source.fileHash.slice(0, 12)}]`;
}

export function clientRequestId(
  source: PDFSource,
  targetLanguage: string,
  engine: string,
  outputMode: FullOutputMode,
): string {
  return `zut-${source.fileHash.slice(0, 32)}-${targetLanguage}-${engine}-${outputMode}`;
}

export function findExistingTranslation(
  source: PDFSource,
  title: string,
): Zotero.Item | undefined {
  if (!source.parentItem) {
    return undefined;
  }
  const attachmentIDs = source.parentItem.getAttachments();
  const attachments = Zotero.Items.get(attachmentIDs);
  return attachments.find(
    (attachment) =>
      attachment.isPDFAttachment() && attachment.getField("title") === title,
  );
}

function safeFileBaseName(title: string): string {
  const cleaned = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim();
  return cleaned || "zut-translated";
}

export async function importTranslatedPDF(
  source: PDFSource,
  task: FullTask,
  blob: Blob,
): Promise<Zotero.Item> {
  const bytes = toBytes(await blob.arrayBuffer());
  if (bytes.length < 5 || new TextDecoder("ascii").decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new Error("后端返回的文件不是有效的 PDF");
  }
  const title = translatedAttachmentTitle(source, task.targetLanguage, task.outputMode, task.engine);
  const existing = findExistingTranslation(source, title);
  if (existing) {
    return existing;
  }

  const tempFile = Zotero.getTempDirectory().clone();
  tempFile.append(`zut-${task.taskId}.pdf`);
  const tempPath = tempFile.path;
  try {
    await IOUtils.write(tempPath, bytes);
    return await Zotero.Attachments.importFromFile({
      file: tempPath,
      libraryID: source.attachment.libraryID,
      parentItemID: source.parentItem?.id,
      title,
      fileBaseName: safeFileBaseName(title),
      contentType: "application/pdf",
    });
  } finally {
    await Zotero.File.removeIfExists(tempPath);
  }
}
