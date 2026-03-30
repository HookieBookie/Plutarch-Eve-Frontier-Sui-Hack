import { useState, useMemo } from "react";
import { useGoals } from "../context/GoalContext";
import { useNetworkMap } from "../hooks/useNetworkMap";
import { useSsuInventory } from "../hooks/useSsuInventory";
import { sanitiseLabel, anonSsuName } from "../utils/ssuNames";
import { OverviewTab } from "../components/tribe/OverviewTab";
import { OperationsTab } from "../components/tribe/OperationsTab";
import { BlueprintsTab } from "../components/tribe/BlueprintsTab";
import { PersonnelTab } from "../components/tribe/PersonnelTab";
import { AnalyticsTab } from "../components/tribe/AnalyticsTab";
import { StorageTab } from "../components/tribe/StorageTab";

type TribeTab = "overview" | "operations" | "blueprints" | "personnel" | "analytics" | "storage";

const ALL_TABS: { key: TribeTab; label: string; ownerOnly?: boolean }[] = [
  { key: "overview", label: "Budget" },
  { key: "operations", label: "Operations" },
  { key: "blueprints", label: "Blueprints", ownerOnly: true },
  { key: "personnel", label: "Personnel" },
  { key: "analytics", label: "Analytics", ownerOnly: true },
  { key: "storage", label: "Storage" },
];

interface TribePageProps {
  isOwner: boolean;
  isTribeMember: boolean;
}

export function TribePage({ isOwner, isTribeMember }: TribePageProps) {
  const [tab, setTab] = useState<TribeTab>("overview");
  const { ssuId, tribeId } = useGoals();
  const { nodes } = useNetworkMap(tribeId);
  const { data: ssuInventory } = useSsuInventory(ssuId || undefined);

  const ssuLabel = useMemo(() => {
    const node = nodes.find((n) => n.ssuId === ssuId);
    if (node?.label) return sanitiseLabel(node.label, ssuId);
    return anonSsuName(ssuId);
  }, [nodes, ssuId]);

  // Prefer the on-chain given name (e.g. "Plutarch HQ") for the title
  const titleName = ssuInventory?.ssuName || ssuLabel;

  const visibleTabs = ALL_TABS.filter((t) => !t.ownerOnly || isOwner);

  return (
    <div className="page-single">
      <section className="panel">
        <h3>
          {titleName}
          {isOwner ? " \u2014 Manager View" : " \u2014 Corporation"}
        </h3>

        <div className="tribe-tabs">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              className={`tribe-tab${tab === t.key ? " tribe-tab-active" : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="tribe-tab-content">
          {tab === "overview" && <OverviewTab isOwner={isOwner} />}
          {tab === "operations" && <OperationsTab isOwner={isOwner} />}
          {tab === "blueprints" && isOwner && <BlueprintsTab />}
          {tab === "personnel" && <PersonnelTab isOwner={isOwner} />}
          {tab === "analytics" && isOwner && <AnalyticsTab />}
          {tab === "storage" && <StorageTab isOwner={isOwner} isTribeMember={isTribeMember} />}
        </div>
      </section>
    </div>
  );
}
