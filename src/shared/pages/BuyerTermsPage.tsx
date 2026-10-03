import { EVENTFLOW_BUYER_TERMS_TEXT, EVENTFLOW_BUYER_TERMS_VERSION } from "../../../shared/legal/documents";
import LegalDocumentPage from "./LegalDocumentPage";
export default function BuyerTermsPage() { return <LegalDocumentPage text={EVENTFLOW_BUYER_TERMS_TEXT} documentVersion={EVENTFLOW_BUYER_TERMS_VERSION} />; }
