import { describe, expect, test } from "vitest";
import { escapeHtml } from "../../src/sanitize";

describe("HTML sanitizing helpers", () => {
  test("escapes text for template-rendered HTML and attributes", () => {
    expect(escapeHtml(`<img src=x onerror="alert('boom')">&`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;boom&#39;)&quot;&gt;&amp;"
    );
  });
});
