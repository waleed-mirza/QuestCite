# Encryption Standard

> SAMPLE DATA — NOT LEGAL OR COMPLIANCE ADVICE.

This fictional standard describes encryption and secret-handling statements used by the Northstar Cloud demo.

## Data protection

Customer data is encrypted at rest using managed AES-256 encryption controls. External connections require TLS 1.2 or later, with TLS 1.3 preferred where supported. Encryption keys are managed by the infrastructure layer and are not stored alongside customer content.

## Key and secret handling

Provider keys and signing material are environment-only. They are not committed to the repository, and the release secret scan checks the packaged source for common credential patterns. Cryptographic configuration is reviewed during security maintenance and material infrastructure changes.

## Review boundary

Managed encryption is documented in this sample; customer-managed key support is not confirmed. Do not infer that feature from the at-rest encryption control. Structured logging redacts content-capable fields so document text and prompts are not logged.
