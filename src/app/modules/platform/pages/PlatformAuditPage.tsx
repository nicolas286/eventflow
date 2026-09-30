import { Helmet } from "react-helmet-async";
import { platformAdminRepo } from "../data/platformAdminRepo";
import { usePlatformQuery } from "../hooks/usePlatformQuery";
import { AsyncState, Badge, PageHeader, Panel } from "../components/PlatformUi";
import { formatDate } from "../components/platformFormat";

export function PlatformAuditPage() {
  const query = usePlatformQuery(platformAdminRepo.audit);
  return <><Helmet><title>Journal · Eventflow Platform</title></Helmet><PageHeader eyebrow="Traçabilité" title="Journal d’audit" />
    <Panel><AsyncState loading={query.loading} error={query.error} empty={query.data?.items.length === 0}><div className="platformTableWrap"><table className="platformTable"><thead><tr><th>Date</th><th>Acteur</th><th>Action</th><th>Cible</th><th>Résultat</th><th>Motif</th></tr></thead><tbody>{query.data?.items.map((item) => <tr key={item.id}><td>{formatDate(item.createdAt)}</td><td>{item.actorEmail ?? item.actorUserId ?? "système"}</td><td><code>{item.action}</code></td><td>{item.targetType}<div className="platformMuted">{item.targetId}</div></td><td><Badge tone={item.outcome === "success" ? "good" : "danger"}>{item.outcome}</Badge></td><td>{item.reason ?? "—"}</td></tr>)}</tbody></table></div></AsyncState></Panel>
  </>;
}
