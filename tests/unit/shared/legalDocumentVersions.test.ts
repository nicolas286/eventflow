import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DPA_VERSION, EVENTFLOW_BUYER_TERMS_VERSION, EVENTFLOW_CONNECT_TERMS_VERSION, EVENTFLOW_PLATFORM_TERMS_VERSION, EVENTFLOW_PRIVACY_VERSION } from "../../../shared/legal/documents";
vi.mock("react-router-dom", () => ({ Link: "a", useNavigate: () => () => {} }));
vi.mock("@ui/components", () => ({ Container: "main" }));
import TermsPage from "../../../src/shared/pages/TermsPage";
import ConnectTermsPage from "../../../src/shared/pages/ConnectTermsPage";
import Privacy from "../../../src/shared/pages/Privacy";
import DataProcessingPage from "../../../src/shared/pages/DataProcessingPage";
import BuyerTermsPage from "../../../src/shared/pages/BuyerTermsPage";

describe("displayed legal document versions", () => {
  it.each([
    [TermsPage, EVENTFLOW_PLATFORM_TERMS_VERSION], [ConnectTermsPage, EVENTFLOW_CONNECT_TERMS_VERSION],
    [Privacy, EVENTFLOW_PRIVACY_VERSION], [DataProcessingPage, DPA_VERSION], [BuyerTermsPage, EVENTFLOW_BUYER_TERMS_VERSION],
  ])("renders the same shared version used by acceptance payloads", (Page, version) => {
    expect(renderToStaticMarkup(createElement(Page))).toContain(`<time dateTime="${version}">${version}</time>`);
  });
});
