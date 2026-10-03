import { DPA_TEXT, DPA_VERSION } from "../../../shared/legal/documents";
import LegalDocumentPage from "./LegalDocumentPage";
export default function DataProcessingPage() { return <LegalDocumentPage text={DPA_TEXT} documentVersion={DPA_VERSION} />; }
