/**
 * Minimal fluent fakes for the PostgREST/auth shapes used by src/server.
 * Results are consumed in call order; any unexpected chain call throws so a
 * future call-site change surfaces in tests instead of silently passing.
 */

export type FakeResult = { data: Record<string, unknown> | null; error: { message: string } | null };

export type FakeSupabase = {
  from: (table: string) => {
    select: () => unknown;
  };
  auth: {
    getClaims: () => Promise<{ data: { claims: unknown } | null; error: { message: string } | null }>;
  };
  tablesQueried: string[];
};

/** Table-query client: each maybeSingle() consumes the next queued result. */
export function fakeTableClient(results: FakeResult[]): FakeSupabase {
  const queue = [...results];
  const tablesQueried: string[] = [];
  const chain = () => {
    const self = {
      select: () => self,
      eq: () => self,
      maybeSingle: async (): Promise<FakeResult> => {
        const next = queue.shift();
        if (next === undefined) {
          throw new Error("fakeTableClient: no queued result left");
        }
        return next;
      },
    };
    return self;
  };
  return {
    from(table: string) {
      tablesQueried.push(table);
      return { select: chain };
    },
    auth: {
      getClaims: async () => {
        throw new Error("fakeTableClient: getClaims not expected");
      },
    },
    tablesQueried,
  };
}

/** Auth-only client for session tests. */
export function fakeAuthClient(claims: unknown, error: { message: string } | null = null): FakeSupabase {
  return {
    from() {
      throw new Error("fakeAuthClient: table queries not expected");
    },
    auth: {
      getClaims: async () => ({ data: { claims }, error }),
    },
    tablesQueried: [],
  };
}
