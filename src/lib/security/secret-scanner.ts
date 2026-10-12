/**
 * Secret-scanning core (plan §16 rule 8, §22). Pure functions so CI, the
 * release audit, and unit tests share one definition of "looks like a real
 * credential". Scans report file + line + pattern NAME — never the match.
 */

export interface SecretFinding {
  readonly file: string;
  readonly line: number;
  readonly pattern: string;
}

interface SecretPattern {
  readonly name: string;
  readonly regex: RegExp;
}

const PATTERNS: readonly SecretPattern[] = [
  { name: "OpenAI API key (sk-…)", regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "Supabase/JWT (eyJ…)", regex: /\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: "AWS access key (AKIA…)", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "GitHub token (ghp_/gho_…)", regex: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { name: "Resend API key (re_…)", regex: /\bre_[A-Za-z0-9]{20,}\b/g },
  { name: "webhook signing secret (whsec… long)", regex: /\bwhsec_[A-Za-z0-9]{30,}\b/g },
  { name: "Private key block", regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
];

/**
 * Values that explicitly mark themselves as placeholders. Fixture files MUST
 * use these markers — a "fake" fixture without one fails the scan on purpose.
 */
const PLACEHOLDER_MARKERS = [
  "fake",
  "example",
  "placeholder",
  "your-",
  "<",
  "xxx",
  "changeme",
  "for-tests",
  "for-test",
  "dummy",
  "sample",
] as const;

export function isPlaceholderValue(value: string): boolean {
  const lowered = value.toLowerCase();
  return PLACEHOLDER_MARKERS.some((marker) => lowered.includes(marker));
}

/** Scan one file's content. Returns findings with file/line/pattern name only. */
export function scanContent(file: string, content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = content.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    for (const pattern of PATTERNS) {
      pattern.regex.lastIndex = 0;
      const match = pattern.regex.exec(line);
      if (match !== null && !isPlaceholderValue(match[0])) {
        findings.push({ file, line: index + 1, pattern: pattern.name });
      }
    }
  }

  return findings;
}

/**
 * Variable names whose values carry credentials. Only these must be empty or
 * explicitly fake-marked in committed fixtures; non-secret configuration
 * (APP_ENV, model names, URLs, slugs) ships real defaults by design.
 */
const SECRET_KEY_NAME_PATTERN = /(KEY|SECRET|TOKEN|PASSWORD|SALT|CREDENTIAL|PRIVATE)$/i;

/** Assert that every secret-bearing value in a dotenv-style fixture is fake or empty. */
export function assertFixtureValuesAreFake(content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const lines = content.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    const assignment = /^([A-Za-z0-9_]+)=(.*)$/.exec(line.trim());
    if (assignment === null) {
      continue;
    }
    const [, key = "", rawValue = ""] = assignment;
    if (!SECRET_KEY_NAME_PATTERN.test(key)) {
      continue; // non-secret configuration — real defaults are fine
    }
    const value = rawValue.replaceAll(/^["']|["']$/g, "");
    if (value !== "" && !isPlaceholderValue(value)) {
      findings.push({ file: "fixture", line: index + 1, pattern: `${key} value is not marked as fake` });
    }
  }

  return findings;
}
