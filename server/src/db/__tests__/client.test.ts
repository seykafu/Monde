import { describe, expect, it } from "vitest";
import { connectionOptions } from "../client.js";

describe("connectionOptions", () => {
  it("turns prepared statements off on Supabase's transaction pooler, with TLS", () => {
    const o = connectionOptions("postgresql://postgres.ref:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres");
    expect(o.prepare).toBe(false);
    expect(o.ssl).toBe("require");
    expect(o.connection).toBeUndefined();
  });
  it("keeps prepared statements and the statement timeout on a session or direct connection", () => {
    for (const url of ["postgresql://postgres.ref:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres", "postgresql://postgres:pw@db.ref.supabase.co:5432/postgres"]) {
      const o = connectionOptions(url);
      expect(o.prepare).toBeUndefined();
      expect(o.ssl).toBe("require");
      expect(o.connection).toEqual({ statement_timeout: 2000 });
    }
  });
  it("leaves local and Fly-internal databases without TLS", () => {
    expect(connectionOptions("postgres://postgres:pw@localhost:5432/monde").ssl).toBeUndefined();
    expect(connectionOptions("postgres://u:p@monde-db-staging.flycast:5432/monde").ssl).toBeUndefined();
    expect(connectionOptions("postgres://u:p@db.example.com:5432/monde?sslmode=disable").ssl).toBeUndefined();
  });
});
