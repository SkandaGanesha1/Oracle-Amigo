import { FileText, FileImage, FileArchive, FileCode, FileSpreadsheet, File as FileIcon } from "lucide-react";

const iconMap: Record<string, typeof FileIcon> = {
  pdf: FileText,
  doc: FileText,
  docx: FileText,
  txt: FileText,
  md: FileText,
  rtf: FileText,
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  svg: FileImage,
  webp: FileImage,
  ico: FileImage,
  zip: FileArchive,
  gz: FileArchive,
  tar: FileArchive,
  rar: FileArchive,
  "7z": FileArchive,
  js: FileCode,
  ts: FileCode,
  tsx: FileCode,
  jsx: FileCode,
  py: FileCode,
  rs: FileCode,
  go: FileCode,
  java: FileCode,
  css: FileCode,
  html: FileCode,
  json: FileCode,
  yml: FileCode,
  yaml: FileCode,
  xml: FileCode,
  csv: FileSpreadsheet,
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,
};

interface FileTypeIconProps {
  extension: string;
  className?: string;
}

export function FileTypeIcon({ extension, className = "h-4 w-4" }: FileTypeIconProps) {
  const ext = extension.toLowerCase().replace(/^\./, "");
  const Icon = iconMap[ext] ?? FileIcon;
  return <Icon className={className} />;
}
