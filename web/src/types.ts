export interface ToolOption {
  id: string;
  label: string;
  type: "enum" | "boolean" | "string";
  values?: string[];
  maxLength?: number;
  help?: string;
  default: string | boolean;
}

export interface EngineStatus {
  id: string;
  found: boolean;
  version?: string;
}

export interface ToolInfo {
  id: string;
  name: string;
  description: string;
  useWhen?: string;
  category: string;
  icon: string;
  tags?: string[];
  input: { kind: "text" | "binary"; accept: string[]; maxBytes?: number };
  output: { contentType: string; extension: string };
  preview: "file" | "html" | "text" | "none";
  options?: ToolOption[];
  ui: { action: string };
  sample?: string;
  status: { ready: boolean; engines: EngineStatus[] };
}

export type OptionValues = Record<string, string | boolean>;

export interface RunResult {
  blob: Blob;
  meta: Record<string, unknown>;
  durationMs: number;
}
