import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import MarkdownText from "../../../src/shared/ui/components/markdowntext/MarkdownText";

describe("Markdown content rendering", () => {
  it("retains headings, emphasis, lists, breaks, tables and safe links", () => {
    const html = renderToStaticMarkup(createElement(MarkdownText, { markdown: "# Titre\n\n**Important**\nLigne suivante\n\n- Billet\n\n| Nom | Prix |\n| --- | --- |\n| Test | 10 |\n\n[Site](https://example.com)" }));
    for (const fragment of ["<h1>Titre</h1>", "<strong>Important</strong>", "<br/>", "<li>Billet</li>", "<table>", 'rel="noopener noreferrer"']) expect(html).toContain(fragment);
  });
  it("ignores raw HTML and does not render executable Markdown URLs", () => {
    const html = renderToStaticMarkup(createElement(MarkdownText, { markdown: '<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n<iframe src="https://example.com"></iframe>\n\n[attaque](javascript:alert%281%29)\n\n**Texte conservé**' }));
    for (const fragment of ["<script", "<img", "onerror", "<iframe", "javascript:"]) expect(html).not.toContain(fragment);
    expect(html).toContain("<strong>Texte conservé</strong>");
  });
});
