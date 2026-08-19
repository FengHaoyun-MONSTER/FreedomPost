import { describe, expect, it } from "vitest";
import {
  CALLOUT_DEFAULT_EMOJI,
  calloutDirective,
  splitCalloutBlocks
} from "./index.js";

describe("callout markdown", () => {
  it("splits a multi-block callout from surrounding markdown", () => {
    expect(splitCalloutBlocks("Before\n\n:::callout{emoji=\"💡\"}\nFirst\n\n- Second\n:::\n\nAfter")).toEqual([
      { type: "markdown", markdown: "Before\n" },
      { type: "callout", emoji: "💡", markdown: "First\n\n- Second" },
      { type: "markdown", markdown: "\nAfter" }
    ]);
  });

  it("normalizes unknown emoji and preserves unmatched directives as markdown", () => {
    expect(splitCalloutBlocks(":::callout{emoji=\"<img>\"}\nText\n:::")).toEqual([
      { type: "callout", emoji: CALLOUT_DEFAULT_EMOJI, markdown: "Text" }
    ]);
    expect(splitCalloutBlocks(":::callout{emoji=\"💡\"}\nText")).toEqual([
      { type: "markdown", markdown: ":::callout{emoji=\"💡\"}\nText" }
    ]);
  });

  it("does not treat directives or closing markers inside code fences as callout structure", () => {
    expect(splitCalloutBlocks('```md\n:::callout{emoji="💡"}\nText\n:::\n```')).toEqual([
      { type: "markdown", markdown: '```md\n:::callout{emoji="💡"}\nText\n:::\n```' }
    ]);
    expect(splitCalloutBlocks(':::callout{emoji="💡"}\n```txt\n:::\n```\n:::')).toEqual([
      { type: "callout", emoji: "💡", markdown: "```txt\n:::\n```" }
    ]);
  });

  it("serializes an empty or populated callout deterministically", () => {
    expect(calloutDirective("📌", "First\n\nSecond")).toBe(
      ":::callout{emoji=\"📌\"}\nFirst\n\nSecond\n:::"
    );
    expect(calloutDirective("unknown", "")).toBe(
      `:::callout{emoji=\"${CALLOUT_DEFAULT_EMOJI}\"}\n\n:::`
    );
  });
});
