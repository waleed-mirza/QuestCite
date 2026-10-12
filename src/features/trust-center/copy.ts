import type { TrustPublicErrorCode } from "@/lib/validation/trust-center";

/**
 * Client-safe copy for the public Trust Center surfaces (rule: raw RPC error
 * codes never reach a public page — everything renders through this table).
 */

export function publicSubmitErrorCopy(code: TrustPublicErrorCode): string {
  switch (code) {
    case "RATE_LIMITED":
      return "Too many requests from you or this page — please try again later.";
    case "REQUEST_DOCUMENTS_INVALID":
      return "One of the selected documents is no longer available. Reload the page and pick again.";
    case "TERMS_NOT_ACCEPTED":
    case "TERMS_NOT_CONFIGURED":
      return "Please accept the terms to continue.";
    case "REQUEST_INPUT_INVALID":
      return "Check your name, company, and work email.";
    case "TRUST_CENTER_NOT_FOUND":
      return "This Trust Center is not available.";
    default:
      return "Something went wrong. Please try again.";
  }
}
