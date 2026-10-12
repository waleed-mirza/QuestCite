import { deflateRawSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Generates the parser fixture corpus (plan §W3 tests: golden fixtures per
 * supported format + empty/corrupt/encrypted/scanned cases).
 *
 * Run: pnpm tsx scripts/make-parser-fixtures.ts
 * Output: tests/fixtures/documents/*
 *
 * Fixtures are committed; regenerate only when a fixture's CONTENT must
 * change — golden tests assert exact extracted text, so regeneration is a
 * reviewable change, never an accident.
 */

const OUT_DIR = path.resolve("tests/fixtures/documents");

// ---------------------------------------------------------------------------
// Minimal PDF writer: objects with a computed xref table. No compression —
// fixtures exist to be read by humans and diffs, not to be small.
// ---------------------------------------------------------------------------

function buildPdf(pageContents: string[], options: { encrypt?: boolean } = {}): Buffer {
  let nextNumber = 1;
  const catalogNumber = nextNumber++;
  const pagesNumber = nextNumber++;
  const pageEntries = pageContents.map(() => {
    const contentNumber = nextNumber++;
    const pageNumber = nextNumber++;
    return { contentNumber, pageNumber };
  });
  const fontNumber = nextNumber++;

  // Content-stream /Length needs the stream body, so build bodies first.
  const contentBodies = pageContents.map((content) => `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const pageBodies = pageEntries.map(
    ({ contentNumber }) =>
      `<< /Type /Page /Parent ${pagesNumber} 0 R /MediaBox [0 0 612 792] `
      + `/Contents ${contentNumber} 0 R /Resources << /Font << /F1 ${fontNumber} 0 R >> >> >>`,
  );

  const objects: Array<{ number: number; body: string }> = [
    { number: catalogNumber, body: `<< /Type /Catalog /Pages ${pagesNumber} 0 R >>` },
    {
      number: pagesNumber,
      body: `<< /Type /Pages /Kids [ ${pageEntries.map(({ pageNumber }) => `${pageNumber} 0 R`).join(" ")} ] /Count ${pageEntries.length} >>`,
    },
    ...contentBodies.map((body, index) => {
      const entry = pageEntries[index];
      if (entry === undefined) {
        throw new Error("unreachable: contentBodies derived from pageContents");
      }
      return { number: entry.contentNumber, body };
    }),
    ...pageBodies.map((body, index) => {
      const entry = pageEntries[index];
      if (entry === undefined) {
        throw new Error("unreachable: pageBodies derived from pageContents");
      }
      return { number: entry.pageNumber, body };
    }),
    { number: fontNumber, body: "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>" },
  ];

  let encryptObjectNumber: number | null = null;
  if (options.encrypt) {
    // A standard-security-handler dictionary whose /O and /U entries are
    // deterministic junk: no viewer (including pdfjs) can derive a working
    // key, so opening it always raises a password error.
    encryptObjectNumber = nextNumber++;
    const junk = "4f6c696d706963205374616449756d".repeat(3).slice(0, 64);
    objects.push({
      number: encryptObjectNumber,
      body: `<< /Filter /Standard /V 1 /R 2 /O <${junk}> /U <${junk}> /P -1 >>`,
    });
  }

  const header = "%PDF-1.4\n";
  let body = "";
  const offsets = new Map<number, number>();
  for (const object of objects) {
    offsets.set(object.number, header.length + body.length);
    body += `${object.number} 0 obj\n${object.body}\nendobj\n`;
  }

  const xrefOffset = header.length + body.length;
  const count = objects.length + 1;
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (const object of objects) {
    const objectOffset = offsets.get(object.number);
    if (objectOffset === undefined) {
      throw new Error(`missing offset for object ${object.number}`);
    }
    xref += `${String(objectOffset).padStart(10, "0")} 00000 n \n`;
  }
  const fileId = "0123456789abcdef0123456789abcdef";
  const encryptRef = encryptObjectNumber === null ? "" : ` /Encrypt ${encryptObjectNumber} 0 R`;
  const trailer = `trailer\n<< /Size ${count}${encryptRef} /ID [<${fileId}> <${fileId}>] /Root ${catalogNumber} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(header + body + xref + trailer, "latin1");
}

function pdfTextPage(lines: string[]): string {
  return lines
    .map((line, index) => `BT /F1 12 Tf 72 ${720 - index * 18} Td (${line.replace(/([()\\])/g, "\\$1")}) Tj ET`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Minimal ZIP (store) writer for the DOCX fixture.
// ---------------------------------------------------------------------------

const crc32Table = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = -1;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ (crc32Table[(crc ^ byte) & 0xff] ?? 0);
  }
  return (crc ^ -1) >>> 0;
}

function buildZip(files: Array<{ name: string; content: Buffer; compress?: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, "utf8");
    const compressed = file.compress ? deflateRawSync(file.content) : file.content;
    const method = file.compress ? 8 : 0;
    const crc = crc32(file.content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.content.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);

    offset += local.length + nameBytes.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralDirectory, eocd]);
}

function docxBuffer(paragraphs: string[]): Buffer {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
    .map((paragraph) => `<w:p><w:r><w:t>${paragraph}</w:t></w:r></w:p>`)
    .join("")}</w:body></w:document>`;
  return buildZip([
    {
      name: "[Content_Types].xml",
      content: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      content: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      ),
    },
    { name: "word/document.xml", content: Buffer.from(documentXml), compress: true },
  ]);
}

// ---------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });

const write = (name: string, content: Buffer | string): void => {
  writeFileSync(path.join(OUT_DIR, name), content);
  console.log("wrote", name);
};

// Golden fixtures — parser tests assert the exact extracted text.
write("basic.txt", "QuestCite onboarding checklist\n\nEnable MFA for all admins.\nReview vendor list quarterly.\n");
write(
  "basic.md",
  "# Access Control Policy\n\nAll production access requires MFA.\n\n## Session Management\n\nSessions expire after 30 minutes of inactivity.\n",
);
write(
  "basic.pdf",
  buildPdf([
    pdfTextPage(["Encryption at Rest", "Customer data is encrypted with AES-256."]),
    pdfTextPage(["Backups are encrypted with separate keys."]),
  ]),
);
write(
  "basic.docx",
  docxBuffer(["Incident Response Overview", "Severity 1 incidents page the on-call engineer within five minutes."]),
);

// Edge fixtures.
write("empty.txt", "");
write("scanned.pdf", buildPdf([pdfTextPage([])])); // valid PDF, zero text operators
write(
  "encrypted.pdf",
  buildPdf([pdfTextPage(["This content is not readable."])], { encrypt: true }),
);
write(
  "corrupt.pdf",
  Buffer.from("%PDF-1.4\nthis is not a pdf body, just deterministic junk with no objects\n", "latin1"),
);

console.log("done:", OUT_DIR);
