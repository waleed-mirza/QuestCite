import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { sellerConfig } from "@/config/seller";

const repositoryRoot = path.resolve(__dirname, "../../..");

function readRepositoryFile(relativePath: string): string {
  return readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

describe("sellerConfig", () => {
  it("publishes the project identity, MIT license, and source repository", () => {
    expect(sellerConfig).toEqual({
      legalName: "WHH Treasures",
      supportEmail: "whhtreasures@gmail.com",
      supportHref: "mailto:whhtreasures@gmail.com",
      licenseName: "MIT",
      repositoryUrl: "https://github.com/waleed-mirza/QuestCite",
    });
    expect(sellerConfig.repositoryUrl.startsWith("https://github.com/")).toBe(true);
  });

  it("keeps the legal and support documents on the MIT license", () => {
    const files = ["LICENSE.md", "SUPPORT.md", "SECURITY.md"];

    for (const file of files) {
      const content = readRepositoryFile(file);
      expect(content, file).toContain(sellerConfig.legalName);
      expect(content, file).toContain(sellerConfig.supportEmail);
      expect(content, file).not.toContain("[OWNER LEGAL NAME]");
    }

    expect(readRepositoryFile("LICENSE.md")).toContain("MIT License");
    expect(readRepositoryFile("docs/licensing.md")).toContain("MIT License");
  });
});
