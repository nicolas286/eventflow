import { EVENTFLOW_PRIVACY_TEXT, EVENTFLOW_PRIVACY_VERSION } from "../../../shared/legal/documents";
import LegalDocumentPage from "./LegalDocumentPage";
export default function Privacy() { return <LegalDocumentPage text={EVENTFLOW_PRIVACY_TEXT} documentVersion={EVENTFLOW_PRIVACY_VERSION} />; }
