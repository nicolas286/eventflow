# Orchestration et missions des sous-agents

L'agent principal reste responsable du besoin, des décisions, de l'intégration et du résultat. Ces fiches reprennent le principe de Nexora avec le périmètre réel d'Eventflow ; elles ne nécessitent aucune installation de sous-agent.

## Quand déléguer

Déléguer une tâche bornée et indépendante lorsque le contexte et les outils l'autorisent. Éviter plusieurs agents sur les mêmes fichiers. Une tâche documentaire ou triviale peut être faite et relue par le principal ; ne pas simuler une revue indépendante.

| Mission | Documents | Livrable |
| --- | --- | --- |
| Composant/formulaire | COMPONENTS, DESIGN_SYSTEM, COPY_I18N | Diff local, états UI et contrôles effectués |
| Backend/RPC | `supabase/AGENTS.md`, SECURITY_REVIEW | Contrat, autorisation, effet SQL et tests |
| Revue technique | REVIEW | Constats classés avec preuve et impact |
| Revue sécurité | SECURITY_REVIEW | Analyse des frontières et scénarios négatifs |
| Tests de contournement | OFFENSIVE_TESTING, TESTING | Reproduction bornée avec résultat attendu/observé |
| Documentation | PROJECT, ARCHITECTURE | Faits, décisions et TODO clairement séparés |

Les noms des fiches ci-dessus désignent les fichiers de ce dossier. Lire aussi les `AGENTS.md` applicables.

## Brief à transmettre

Objectif, critères d'acceptation, fichiers autorisés, documents à lire, contrats à préserver, environnement permis, validations attendues et exclusions. Préciser si la mission est en lecture seule. Partager des références et fixtures, pas des secrets inutiles.

Le principal conserve les arbitrages métier, paiements, autorisations, migrations sensibles et publications distantes. Un sous-agent ne pousse, fusionne ou déploie pas de sa propre initiative.

## Intégration

Relire le diff réel, arbitrer les constats, corriger les problèmes confirmés, puis relancer seulement les vérifications affectées. Pour un changement sensible, utiliser les grilles technique et sécurité ; une revue indépendante est préférable si disponible. Signaler toute limite de revue ou de test.
