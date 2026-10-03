import { EVENTFLOW_TERMS_TEXT, EVENTFLOW_PLATFORM_TERMS_VERSION } from "../../../shared/legal/documents";
import LegalDocumentPage from "./LegalDocumentPage";
export default function TermsPage() { return <LegalDocumentPage text={EVENTFLOW_TERMS_TEXT} documentVersion={EVENTFLOW_PLATFORM_TERMS_VERSION} />; }
