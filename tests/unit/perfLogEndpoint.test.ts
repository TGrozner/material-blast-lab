import { describe, expect, test } from "vitest";
import { isAllowedPerfLogRequest, sanitizePerfSessionId } from "../../vite.config";

describe("dev perf log endpoint guards", () => {
  test("accepts only same-origin JSON perf log requests with the internal header", () => {
    expect(
      isAllowedPerfLogRequest({
        headers: {
          host: "localhost:5173",
          origin: "http://localhost:5173",
          "content-type": "application/json; charset=utf-8",
          "x-downtown-mayhem-perf-log": "1"
        }
      })
    ).toBe(true);

    expect(
      isAllowedPerfLogRequest({
        headers: {
          host: "localhost:5173",
          origin: "https://example.test",
          "content-type": "application/json",
          "x-downtown-mayhem-perf-log": "1"
        }
      })
    ).toBe(false);
    expect(
      isAllowedPerfLogRequest({
        headers: {
          host: "localhost:5173",
          origin: "http://localhost:5173",
          "content-type": "text/plain",
          "x-downtown-mayhem-perf-log": "1"
        }
      })
    ).toBe(false);
    expect(
      isAllowedPerfLogRequest({
        headers: {
          host: "localhost:5173",
          origin: "http://localhost:5173",
          "content-type": "application/json"
        }
      })
    ).toBe(false);
  });

  test("keeps perf log session filenames bounded and path-safe", () => {
    const sessionId = sanitizePerfSessionId("../bad/session:<script>".repeat(8));

    expect(sessionId).toHaveLength(96);
    expect(sessionId).not.toContain("/");
    expect(sessionId).not.toContain("<");
    expect(sessionId).not.toContain(">");
  });
});
