type AnnotationJSON = _ZoteroTypes.Annotations.AnnotationJson;

async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)]
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function generateKey(): string {
  const host = Zotero as typeof Zotero & {
    DataObjectUtilities?: { generateKey?: () => string };
  };
  return (
    host.DataObjectUtilities?.generateKey?.() ??
    Zotero.randomString(8, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
  );
}

function cloneAnnotation(annotation: AnnotationJSON): AnnotationJSON {
  return JSON.parse(JSON.stringify(annotation)) as AnnotationJSON;
}

export async function saveTranslationToAnnotation(
  attachment: Zotero.Item,
  annotation: AnnotationJSON,
  translatedText: string,
  provider: string,
  targetLanguage: string,
): Promise<boolean> {
  if (annotation.readOnly || !attachment.isEditable()) {
    throw new Error("当前 PDF 注释为只读，无法保存译文");
  }
  const marker =
    "ZUT:" + (await digest(annotation.text + translatedText + targetLanguage + provider));
  const key = annotation.key || annotation.id;
  const saved = key ? Zotero.Items.getByLibraryAndKey(attachment.libraryID, key) : undefined;
  if (saved && (!saved.isAnnotation() || saved.parentItemID !== attachment.id || !saved.isEditable())) {
    throw new Error("无法编辑所选注释");
  }
  const current = (saved ? saved.annotationComment : annotation.comment)?.trim() ?? "";
  if (current.includes(marker)) {
    return false;
  }
  const block = [
    "[ZUT]",
    "marker: " + marker,
    "provider: " + provider,
    "target: " + targetLanguage,
    "translation:",
    translatedText.trim(),
  ].join("\n");
  const json = saved ? await Zotero.Annotations.toJSON(saved) : cloneAnnotation(annotation);
  json.key = saved ? saved.key : generateKey();
  json.comment = current ? current + "\n\n" + block : block;
  json.readOnly = false;
  await Zotero.Annotations.saveFromJSON(attachment, json);
  annotation.key = json.key;
  annotation.comment = json.comment;
  return true;
}
