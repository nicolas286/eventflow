import { Link, useNavigate } from "react-router-dom";
import { Container } from "@ui/components";
import Card, { CardBody, CardHeader } from "@ui/components/card/Card";
import Button from "@ui/components/button/Button";
import "./legalPage.desktop.css";
import "./legalPage.mobile.css";

function LinkedText({ text }: { text: string }) {
  return text.split(/(https:\/\/[^\s]+|contact@useeventflow\.eu|\/conditions-connect|\/accord-traitement-donnees)/g).map((part, index) => {
    const url = part.startsWith("https://") ? part.replace(/[.;]$/, "") : null;
    if (url) return <span key={index}><a href={url} target="_blank" rel="noreferrer">{url}</a>{part.slice(url.length)}</span>;
    if (part === "contact@useeventflow.eu") return <a key={index} href={`mailto:${part}`}>{part}</a>;
    if (part.startsWith("/")) return <Link key={index} to={part}>{part === "/conditions-connect" ? "Conditions Stripe Connect" : "Accord de traitement des données"}</Link>;
    return part;
  });
}

export default function LegalDocumentPage({ text, documentVersion }: { text: string; documentVersion?: string }) {
  const navigate = useNavigate();
  const [intro, ...sections] = text.split("\n\n");
  const [title, version] = intro.split("\n");
  return <Container><div className="legalPage"><Card>
    <CardHeader title={title} />
    <CardBody>
      <p>{version}{documentVersion ? <> · <time dateTime={documentVersion}>{documentVersion}</time></> : null}</p>
      {sections.map((section, index) => {
        const lines = section.split("\n");
        const hasHeading = /^\d+\./.test(lines[0]) || ["Éditeur du site", "Hébergement du site", "Responsabilité", "Propriété intellectuelle"].includes(lines[0]);
        return <section className="legalSection" key={index}>
          {hasHeading && <h2>{lines[0]}</h2>}
          {lines.slice(hasHeading ? 1 : 0).map((line, lineIndex) => <p key={lineIndex}><LinkedText text={line} /></p>)}
        </section>;
      })}
      <nav aria-label="Documents juridiques"><p>
        <Link to="/cgu">CGU</Link>{" · "}<Link to="/conditions-billetterie">Billetterie</Link>{" · "}
        <Link to="/conditions-connect">Stripe Connect</Link>{" · "}<Link to="/accord-traitement-donnees">Traitement des données</Link>{" · "}
        <Link to="/politique-confidentialite">Confidentialité</Link>{" · "}<Link to="/mentions-legales">Mentions légales</Link>
      </p></nav>
      <div className="legalFooter"><Button variant="secondary" onClick={() => navigate(-1)}>← Retour</Button></div>
    </CardBody>
  </Card></div></Container>;
}
