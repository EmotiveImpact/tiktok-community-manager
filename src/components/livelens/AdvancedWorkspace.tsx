import { Missions, Alerts } from "./advanced/Missions";
import Investigations from "./advanced/Investigations";
import ContextGraph from "./advanced/ContextGraph";
import { Workspace, AgentConnection } from "./advanced/Workspace";
import type { OpenEvidence } from "./advanced/shared";
import "./advanced/workspace.css";
export { ReviewedReport } from "./advanced/Investigations";

export default function AdvancedWorkspace({
  view,
  onOpenEvidence,
  initialCaseId,
  onSelectCase,
  revision = 0,
}: {
  view: string;
  onOpenEvidence: OpenEvidence;
  initialCaseId?: string | null;
  onSelectCase?: (caseId: string | null) => void;
  revision?: number;
}) {
  return (
    <div className="aw-workspace">
      {view === "missions" && <Missions onOpenEvidence={onOpenEvidence} />}
      {view === "alerts" && <Alerts onOpenEvidence={onOpenEvidence} />}
      {view === "investigations" && (
        <Investigations
          onOpenEvidence={onOpenEvidence}
          initialCaseId={initialCaseId}
          onSelectCase={onSelectCase}
        />
      )}
      {view === "graph" && <ContextGraph onOpenEvidence={onOpenEvidence} />}
      {view === "workspace" && <Workspace revision={revision} />}
      {view === "agent" && <AgentConnection />}
    </div>
  );
}
