"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import type { PublicTrustCenter } from "@/server/services/trust-public";

/**
 * The public Trust Center body (wireframe §6): server-rendered data, one
 * client-side search box filtering the rendered sections. Everything this
 * component receives came through the allowlisted public read — there is no
 * draft/internal field in the type to accidentally render (plan §W7 gate).
 */
export function PublicTrustCenterView({ slug, data }: { slug: string; data: PublicTrustCenter }) {
  const searchParams = useSearchParams();
  const preselected = searchParams.get("doc");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const matches = (...fields: Array<string | null | undefined>) =>
    q === "" || fields.some((field) => (field ?? "").toLowerCase().includes(q));

  const faqs = data.faqs.filter((faq) => matches(faq.question, faq.answer));
  const certifications = data.certifications.filter((cert) => matches(cert.name, cert.issuer));
  const subprocessors = data.subprocessors.filter((sub) =>
    matches(sub.company, sub.purpose, sub.dataCategory, sub.region),
  );
  const documents = data.documents.filter((doc) => matches(doc.title, doc.description, doc.category));

  return (
    <div className="grid gap-10">
      <div className="grid gap-2">
        <label htmlFor="trust-search" className="text-sm font-medium">
          Search public content
        </label>
        <input
          id="trust-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="e.g. SOC 2, encryption, subprocessors"
          className="border-input bg-background h-10 rounded-md border px-3 text-sm"
        />
      </div>

      <section aria-labelledby="overview-heading" className="grid gap-3">
        <h2 id="overview-heading" className="text-xl font-semibold">
          Security overview
        </h2>
        {data.overview === null ? null : (
          <div className="grid gap-3 text-sm leading-relaxed whitespace-pre-line">{data.overview}</div>
        )}
      </section>

      <section aria-labelledby="certs-heading" className="grid gap-3">
        <h2 id="certs-heading" className="text-xl font-semibold">
          Certifications
        </h2>
        {certifications.length === 0 ? (
          <p className="text-muted-foreground text-sm">No matching certifications.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {certifications.map((cert) => (
              <li
                key={`${cert.name}-${cert.issuer ?? "none"}`}
                className="rounded-full border px-3 py-1 text-sm"
              >
                {cert.name}
                {cert.demo ? " (Demo)" : ""}
                {cert.status !== "active" ? ` · ${cert.status}` : ""}
                {cert.validUntil !== null ? ` · valid to ${cert.validUntil}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="subs-heading" className="grid gap-3">
        <h2 id="subs-heading" className="text-xl font-semibold">
          Subprocessors
        </h2>
        {subprocessors.length === 0 ? (
          <p className="text-muted-foreground text-sm">No matching subprocessors.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th scope="col" className="py-2 pr-4 font-medium">Company</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Purpose</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Data category</th>
                  <th scope="col" className="py-2 font-medium">Region</th>
                </tr>
              </thead>
              <tbody>
                {subprocessors.map((sub) => (
                  <tr key={`${sub.company}-${sub.region}`} className="border-b last:border-0">
                    <td className="py-2 pr-4">{sub.company}</td>
                    <td className="py-2 pr-4">{sub.purpose}</td>
                    <td className="py-2 pr-4">{sub.dataCategory}</td>
                    <td className="py-2">{sub.region}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="faq-heading" className="grid gap-3">
        <h2 id="faq-heading" className="text-xl font-semibold">
          FAQ
        </h2>
        {faqs.length === 0 ? (
          <p className="text-muted-foreground text-sm">No matching questions.</p>
        ) : (
          <dl className="grid gap-2">
            {faqs.map((faq) => (
              <div key={faq.question} className="rounded-md border p-3">
                <dt className="text-sm font-medium">{faq.question}</dt>
                <dd className="text-muted-foreground mt-1 text-sm whitespace-pre-line">{faq.answer}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section aria-labelledby="docs-heading" className="grid gap-3">
        <h2 id="docs-heading" className="text-xl font-semibold">
          Documents you can request
        </h2>
        {documents.length === 0 ? (
          <p className="text-muted-foreground text-sm">No matching documents.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {documents.map((doc) => (
              <li key={doc.documentId} className="grid content-start gap-2 rounded-lg border p-4">
                <p className="font-medium">{doc.title}</p>
                <p className="text-muted-foreground text-sm">{doc.description}</p>
                <p className="text-muted-foreground text-xs">{doc.category}</p>
                <Link
                  href={`/trust/${slug}/request?doc=${doc.documentId}`}
                  className="inline-flex h-9 w-fit items-center rounded-md bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Request access{preselected === doc.documentId ? " (selected)" : ""}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="border-t pt-4 text-sm">
        <p>
          Contact:{" "}
          {data.contactEmail === null ? null : (
            <a href={`mailto:${data.contactEmail}`} className="underline">
              {data.contactEmail}
            </a>
          )}
        </p>
        <p className="text-muted-foreground mt-1">© {data.displayName ?? data.slug}</p>
      </footer>
    </div>
  );
}
