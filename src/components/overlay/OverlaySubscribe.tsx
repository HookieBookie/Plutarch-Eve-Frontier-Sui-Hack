import { useGoals } from "../../context/GoalContext";
import {
  useOverlaySubscriptions,
  useAddOverlaySubscription,
  useRemoveOverlaySubscription,
} from "../../hooks/useOverlaySubscriptions";

interface OverlaySubscribeProps {
  wallet: string;
  ssuId: string;
  tribeId: string;
}

export function OverlaySubscribe({ wallet, ssuId, tribeId }: OverlaySubscribeProps) {
  const { goals } = useGoals();
  const { data: subs = [] } = useOverlaySubscriptions(wallet, ssuId, tribeId);
  const addSub = useAddOverlaySubscription();
  const removeSub = useRemoveOverlaySubscription();

  const publishedGoals = goals.filter((g) => g.status === "published" || g.status === "draft");
  if (publishedGoals.length === 0) {
    return <p className="muted" style={{ fontSize: "0.8rem" }}>No goals available to track.</p>;
  }

  return (
    <div className="overlay-subscribe">
      {publishedGoals.map((goal) => {
        const pubMissions = goal.missions.filter((_m, idx) => goal.publishedMissions.has(idx));
        if (pubMissions.length === 0) return null;
        return (
          <div key={goal.id} className="overlay-subscribe-goal">
            <div className="overlay-subscribe-goal-header">
              <span className="overlay-subscribe-goal-type">{goal.type}</span>
              <span className="overlay-subscribe-goal-desc">{goal.description}</span>
            </div>
            <div className="overlay-subscribe-missions">
              {pubMissions.map((mission) => {
                const missionIdx = goal.missions.indexOf(mission);
                const isSubscribed = subs.some(
                  (s) => s.goalId === goal.id && s.missionIdx === missionIdx,
                );
                return (
                  <label key={missionIdx} className="overlay-subscribe-mission">
                    <input
                      type="checkbox"
                      checked={isSubscribed}
                      onChange={(e) => {
                        const params = { wallet, ssuId, tribeId, goalId: goal.id, missionIdx };
                        if (e.target.checked) {
                          addSub.mutate(params);
                        } else {
                          removeSub.mutate(params);
                        }
                      }}
                    />
                    <span className="overlay-subscribe-phase">{mission.phase}</span>
                    <span>{mission.description}</span>
                    <span className="muted" style={{ marginLeft: "auto", fontSize: "0.75rem" }}>
                      ×{mission.quantity}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
