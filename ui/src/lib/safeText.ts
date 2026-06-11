const CONTROL_CHARS_EXCEPT_WHITESPACE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const MOJIBAKE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/â€”/g, "-"],
  [/â€“/g, "-"],
  [/â€¦/g, "..."],
  [/âœ…/g, "OK"],
  [/Â·/g, "-"],
  [/Â /g, " "],
];

export function safeDisplayText(value: unknown): string {
  const raw = typeof value === "string" ? value : value == null ? "" : String(value);
  return MOJIBAKE_REPLACEMENTS.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    raw.replace(CONTROL_CHARS_EXCEPT_WHITESPACE, "")
  );
}

const READABLE_ROOT_MAP: Array<[RegExp, string]> = [
  [/[Cc]:\\[Uu]sers\\[^\\]+\\Downloads(?:\\)?/g, "Downloads/"],
  [/[Cc]:\\[Uu]sers\\[^\\]+\\Documents(?:\\)?/g, "Documents/"],
  [/[Cc]:\\[Uu]sers\\[^\\]+\\Desktop(?:\\)?/g, "Desktop/"],
  [/[Cc]:\\[Uu]sers\\[^\\]+\\Pictures(?:\\)?/g, "Pictures/"],
  [/[Cc]:\\[Uu]sers\\[^\\]+\\Music(?:\\)?/g, "Music/"],
  [/[Cc]:\\[Uu]sers\\[^\\]+\\Videos(?:\\)?/g, "Videos/"],
  [/[Cc]:\\[Uu]sers\\[^\\]+\\Finance(?:\\)?/g, "Finance/"],
  [/[Cc]:\\[Uu]sers\\[^\\]+\\Work(?:\\)?/g, "Work/"],
  [/[Cc]:\\[Uu]sers\\[^\\]+\\(?:\\)?/g, "User/"],
  [/\/([Uu]sers)\/[^\/]+\/Downloads(?:\/)?/g, "Downloads/"],
  [/\/([Uu]sers)\/[^\/]+\/Documents(?:\/)?/g, "Documents/"],
  [/\/([Uu]sers)\/[^\/]+\/Desktop(?:\/)?/g, "Desktop/"],
];

export function readableFilePath(path: string): string {
  let result = path;
  for (const [pattern, replacement] of READABLE_ROOT_MAP) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
