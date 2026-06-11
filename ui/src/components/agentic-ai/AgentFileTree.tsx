import { useState } from "react";
import { Folder, FolderOpen, File, FileText, FileCode, FileImage, ChevronRight, ChevronDown } from "lucide-react";

interface TreeNode {
  name: string;
  type: "file" | "directory";
  path: string;
  size?: number;
  children?: TreeNode[];
}

interface AgentFileTreeProps {
  root: TreeNode;
  onSelect?: (path: string) => void;
  selectedPath?: string;
  maxDepth?: number;
  className?: string;
}

const fileIcon: Record<string, typeof File> = {
  ts: FileCode,
  tsx: FileCode,
  js: FileCode,
  jsx: FileCode,
  json: FileCode,
  md: FileText,
  css: FileCode,
  html: FileCode,
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  svg: FileImage,
  pdf: FileText,
};

function getFileIcon(name: string) {
  const ext = name.split(".").pop() ?? "";
  const Icon = fileIcon[ext] ?? File;
  return Icon;
}

function formatSize(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileTreeNode({
  node,
  depth,
  onSelect,
  selectedPath,
  maxDepth,
}: {
  node: TreeNode;
  depth: number;
  onSelect?: (path: string) => void;
  selectedPath?: string;
  maxDepth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const isDir = node.type === "directory";
  const isSelected = selectedPath === node.path;
  const Icon = isDir ? (expanded ? FolderOpen : Folder) : getFileIcon(node.name);

  if (depth > maxDepth) return null;

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (isDir) setExpanded(!expanded);
          else onSelect?.(node.path);
        }}
        className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs transition ${
          isSelected
            ? "bg-oa-blue/10 text-oa-blue"
            : "text-oa-text-secondary hover:bg-oa-surface"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {isDir && (
          expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <Icon className={`h-3.5 w-3.5 shrink-0 ${isDir ? "text-oa-amber" : "text-oa-text-muted"}`} />
        <span className="truncate">{node.name}</span>
        {node.size !== undefined && (
          <span className="ml-auto text-[10px] text-oa-text-disabled">{formatSize(node.size)}</span>
        )}
      </button>

      {isDir && expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onSelect={onSelect}
              selectedPath={selectedPath}
              maxDepth={maxDepth}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function AgentFileTree({ root, onSelect, selectedPath, maxDepth = 8, className }: AgentFileTreeProps) {
  return (
    <div className={`rounded-xl border border-oa-border bg-oa-surface ${className ?? ""}`}>
      <div className="flex items-center gap-2 border-b border-oa-border px-4 py-2.5">
        <FolderOpen className="h-4 w-4 text-oa-amber" />
        <span className="text-xs font-semibold uppercase tracking-wider text-oa-text-muted">Files</span>
      </div>
      <div className="max-h-80 overflow-y-auto p-1.5">
        <FileTreeNode
          node={root}
          depth={0}
          onSelect={onSelect}
          selectedPath={selectedPath}
          maxDepth={maxDepth}
        />
      </div>
    </div>
  );
}
