"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveBrandingAction, type ActionState } from "@/features/trust-center/actions";
import type { TrustCenterRow } from "@/server/services/trust-center";

/**
 * Branding + clickwrap terms editor (plan §W7 "branding, slug, hero, …
 * contact information" + "clickwrap terms version"). Terms changes are
 * versioned by the admin — bump the version when changing the text; existing
 * acceptances pin the hash of the exact text they agreed to.
 */
export function BrandingForm({ orgSlug, trustCenter }: { orgSlug: string; trustCenter: TrustCenterRow }) {
  const [state, formAction] = useActionState<ActionState | null, FormData>(
    (prev, formData) => saveBrandingAction(orgSlug, prev, formData),
    null,
  );

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="tc-display-name">Display name</Label>
          <Input id="tc-display-name" name="displayName" defaultValue={trustCenter.display_name ?? ""} required maxLength={120} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="tc-contact-email">Contact email</Label>
          <Input id="tc-contact-email" name="contactEmail" type="email" defaultValue={trustCenter.contact_email ?? ""} required maxLength={254} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="tc-hero-title">Headline</Label>
        <Input id="tc-hero-title" name="heroTitle" defaultValue={trustCenter.hero_title ?? ""} required maxLength={160} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="tc-hero-subtitle">Subtitle (optional)</Label>
        <Input id="tc-hero-subtitle" name="heroSubtitle" defaultValue={trustCenter.hero_subtitle ?? ""} maxLength={240} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="tc-overview">Security overview</Label>
        <textarea
          id="tc-overview"
          name="overview"
          defaultValue={trustCenter.overview ?? ""}
          required
          minLength={20}
          maxLength={4000}
          rows={5}
          className="border-input bg-background min-h-24 rounded-md border px-3 py-2 text-sm"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="tc-logo-url">Logo URL — https only (optional)</Label>
        <Input id="tc-logo-url" name="logoUrl" defaultValue={trustCenter.logo_url ?? ""} maxLength={500} placeholder="https://…" />
      </div>
      <fieldset className="grid gap-3 rounded-md border p-3">
        <legend className="text-sm font-medium">Clickwrap terms</legend>
        <div className="grid gap-1.5">
          <Label htmlFor="tc-terms-version">Terms version</Label>
          <Input id="tc-terms-version" name="termsVersion" defaultValue={trustCenter.terms_version} required maxLength={40} placeholder="v1" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="tc-terms-text">Terms text (displayed at request time)</Label>
          <textarea
            id="tc-terms-text"
            name="termsText"
            defaultValue={trustCenter.terms_text}
            required
            minLength={20}
            maxLength={20000}
            rows={4}
            className="border-input bg-background min-h-24 rounded-md border px-3 py-2 text-sm"
          />
        </div>
        <p className="text-muted-foreground text-xs">
          Bump the version when you change the text — new requests record the new version; past acceptances keep the old one.
        </p>
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="requireEmailVerification"
          defaultChecked={trustCenter.require_email_verification}
          className="size-4"
        />
        Require email verification before requests reach the queue
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit">Save branding &amp; terms</Button>
        {state !== null && state.status !== "idle" ? (
          <p
            role={state.status === "error" ? "alert" : "status"}
            className={state.status === "error" ? "text-destructive text-sm" : "text-muted-foreground text-sm"}
          >
            {state.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
