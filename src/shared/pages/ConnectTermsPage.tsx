import { CONNECT_TERMS_TEXT, EVENTFLOW_CONNECT_TERMS_VERSION } from "../../../shared/legal/documents";
import LegalDocumentPage from "./LegalDocumentPage";
export default function ConnectTermsPage() { return <LegalDocumentPage text={CONNECT_TERMS_TEXT} documentVersion={EVENTFLOW_CONNECT_TERMS_VERSION} />; }
