import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredFiles = [
  "README.md",
  "LICENSE.md",
  "SECURITY.md",
  "SUPPORT.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "docs/quickstart.md",
  "docs/deployment.md",
  "docs/demo-mode.md",
  "docs/customization.md",
  "docs/architecture.md",
  "docs/data-flow.md",
  "docs/supported-files.md",
  "docs/troubleshooting.md",
  "docs/legal-disclaimers.md",
  "docs/licensing.md",
];

function markdownFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...markdownFiles(absolute));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(absolute);
    }
  }
  return files;
}

function relativeFile(file: string): string {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function main(): number {
  const missing = requiredFiles.filter((file) => !existsSync(path.join(root, file)));
  if (missing.length > 0) {
    console.error(`Documentation check failed: missing ${missing.join(", ")}.`);
    return 1;
  }

  const topLevelDocs = ["README.md", "LICENSE.md", "SECURITY.md", "SUPPORT.md", "CHANGELOG.md", "CONTRIBUTING.md"];
  const files = [
    ...topLevelDocs.map((file) => path.join(root, file)),
    ...markdownFiles(path.join(root, "docs")),
    ...markdownFiles(path.join(root, "assets")),
  ];
  const broken: string[] = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const linkPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g;
    for (const match of content.matchAll(linkPattern)) {
      const target = match[1];
      if (target === undefined || isExternal(target)) {
        continue;
      }
      const withoutHash = target.split("#", 1)[0] ?? "";
      const withoutQuery = withoutHash.split("?", 1)[0] ?? "";
      if (withoutQuery === "") {
        continue;
      }
      let decoded = withoutQuery;
      try {
        decoded = decodeURIComponent(withoutQuery);
      } catch {
        broken.push(`${relativeFile(file)} -> ${target}`);
        continue;
      }
      const candidate = path.resolve(path.dirname(file), decoded);
      if (!candidate.startsWith(root + path.sep) && candidate !== root) {
        broken.push(`${relativeFile(file)} -> ${target}`);
        continue;
      }
      if (!existsSync(candidate) || !statSync(candidate).isFile()) {
        broken.push(`${relativeFile(file)} -> ${target}`);
      }
    }
  }

  const contentByFile = new Map(files.map((file) => [relativeFile(file), readFileSync(file, "utf8")]));
  const requiredSnippets: Array<[string, string]> = [
    ["README.md", "pnpm demo:seed"],
    ["README.md", "pnpm demo:verify"],
    ["docs/quickstart.md", "pnpm db:migrate:remote"],
    ["docs/deployment.md", "DEMO_UPLOADS_ENABLED=false"],
    ["docs/demo-mode.md", "DEMO_EMAILS_ENABLED=false"],
    ["LICENSE.md", "MIT License"],
  ];
  const missingSnippets = requiredSnippets.filter(([file, snippet]) => !(contentByFile.get(file) ?? "").includes(snippet));
  if (broken.length > 0 || missingSnippets.length > 0) {
    if (broken.length > 0) {
      console.error(`Documentation check failed: ${broken.length} broken local link(s).`);
      for (const item of broken) console.error(`  ${item}`);
    }
    if (missingSnippets.length > 0) {
      console.error(`Documentation check failed: ${missingSnippets.length} required snippet(s) missing.`);
      for (const [file, snippet] of missingSnippets) console.error(`  ${file}: ${snippet}`);
    }
    return 1;
  }
  console.log(`Documentation check passed: ${files.length} Markdown files and ${requiredFiles.length} required assets checked.`);
  return 0;
}

function isExternal(target: string): boolean {
  return target.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("//");
}

process.exitCode = main();
