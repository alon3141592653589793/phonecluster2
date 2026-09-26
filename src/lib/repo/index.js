import { androidFiles } from "./android";
import { kotlinFiles } from "./kotlin";
import { nativeFiles } from "./native";
import { pcFiles } from "./pc";
import { ciFiles } from "./ci";

export const repoFiles = [...ciFiles, ...androidFiles, ...nativeFiles, ...kotlinFiles, ...pcFiles];

export function buildRows(files) {
  const rows = [];
  const seen = new Set();
  [...files]
    .sort((a, b) => a.path.localeCompare(b.path))
    .forEach((f) => {
      const parts = f.path.split("/");
      parts.slice(0, -1).forEach((name, i) => {
        const key = parts.slice(0, i + 1).join("/");
        if (!seen.has(key)) {
          seen.add(key);
          rows.push({ type: "dir", name, depth: i, key });
        }
      });
      rows.push({ type: "file", name: parts[parts.length - 1], depth: parts.length - 1, key: f.path, file: f });
    });
  return rows;
}

export function buildSetupScript(files) {
  let out = "#!/usr/bin/env bash\n# PhoneClusterApp repository bootstrap\nset -e\n\n";
  files.forEach((f) => {
    out += "mkdir -p \"$(dirname '" + f.path + "')\"\n";
    out += "cat > '" + f.path + "' <<'PCA_EOF'\n" + f.content + "PCA_EOF\n\n";
  });
  out += "echo \"PhoneClusterApp scaffold created (" + files.length + " files).\"\n";
  return out;
}

export function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}