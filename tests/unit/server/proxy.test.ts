import { beforeEach, describe, expect, it, vi } from "vitest";

type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };

type CapturedOptions = {
  cookies: {
    getAll: () => Array<{ name: string; value: string }>;
    setAll: (cookies: CookieToSet[]) => void;
  };
};

const state: {
  claims: unknown;
  claimsError: { message: string } | null;
  options: CapturedOptions | undefined;
  rotateDuringGetClaims: boolean;
} = {
  claims: null,
  claimsError: null,
  options: undefined,
  rotateDuringGetClaims: false,
};

vi.mock("@supabase/ssr", () => ({
  // Minimal stand-in: the assertion only checks name=value ordering, and the
  // proxy treats the writer as opaque (attributes come from the library).
  serializeCookieHeader: (name: string, value: string): string => `${name}=${value}`,
  createServerClient: (_url: string, _key: string, options: CapturedOptions) => {
    state.options = options;
    return {
      auth: {
        getClaims: async () => {
          // The real library writes rotated cookies through the adapter while
          // getClaims runs — reproduce that timing here.
          if (state.rotateDuringGetClaims) {
            options.cookies.setAll([{ name: "sb-rotated-token", value: "new-value", options: { path: "/" } }]);
          }
          return { data: { claims: state.claims }, error: state.claimsError };
        },
      },
    };
  },
}));

import { NextRequest, NextResponse } from "next/server";

import { resetServerEnvCache } from "@/lib/env";
import { config, proxy } from "@/proxy";

function requestFor(path: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, undefined);
}

function expectNextResponse(response: unknown): NextResponse {
  if (!(response instanceof NextResponse)) {
    throw new Error("proxy returned a non-NextResponse value");
  }
  return response;
}

describe("proxy", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    resetServerEnvCache();
    state.claims = null;
    state.claimsError = null;
    state.options = undefined;
  });

  it("redirects anonymous users from /app/** to login with redirectTo", async () => {
    const response = expectNextResponse(await proxy(requestFor("/app/org-one/members")));
    const location = response.headers.get("location");
    expect(location).toContain("/login?redirectTo=");
    expect(location).toContain(encodeURIComponent("/app/org-one/members"));
  });

  it("redirects anonymous users from /onboarding to login", async () => {
    const response = expectNextResponse(await proxy(requestFor("/onboarding")));
    expect(response.headers.get("location")).toContain("/login?redirectTo=");
  });

  it("lets anonymous users reach public pages", async () => {
    const response = expectNextResponse(await proxy(requestFor("/")));
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects signed-in users away from auth forms to the workspace router", async () => {
    state.claims = { sub: "user-1", email: "u@example.com" };
    const response = expectNextResponse(await proxy(requestFor("/login")));
    expect(response.headers.get("location")).toContain("/onboarding");
  });

  it("keeps signed-in users on app pages", async () => {
    state.claims = { sub: "user-1" };
    const response = expectNextResponse(await proxy(requestFor("/app/org-one")));
    expect(response.headers.get("location")).toBeNull();
  });

  it("treats verification errors as anonymous (fail closed)", async () => {
    state.claims = { sub: "user-1" };
    state.claimsError = { message: "jwt expired" };
    const response = expectNextResponse(await proxy(requestFor("/onboarding")));
    expect(response.headers.get("location")).toContain("/login");
  });

  it("reads incoming cookies and writes rotated cookies onto the response", async () => {
    const request = requestFor("/app/x");
    request.cookies.set("sb-existing", "value");
    state.rotateDuringGetClaims = true;
    const response = await proxy(request);

    // Incoming cookies are readable through the adapter.
    expect(state.options?.cookies.getAll()).toContainEqual({ name: "sb-existing", value: "value" });

    // Cookies rotated during getClaims ride the redirect response.
    const typed = expectNextResponse(response);
    expect(typed.headers.getSetCookie().join("\n")).toContain("sb-rotated-token=new-value");
  });

  it("matcher excludes API and Next internals", () => {
    const matcher = Array.isArray(config.matcher) ? config.matcher.join(",") : String(config.matcher);
    expect(matcher).toContain("_next/static");
    expect(matcher).toContain("(?!api");
  });
});
