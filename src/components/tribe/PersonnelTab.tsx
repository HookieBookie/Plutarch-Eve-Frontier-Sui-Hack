import { useState } from "react";
import { useGoals } from "../../context/GoalContext";
import { useWings } from "../../hooks/useWings";
import { useMembers } from "../../hooks/useMembers";
import { fetchCharacter } from "../../hooks/useCharacter";

const WING_COLORS = ["#FF6600", "#33CC66", "#3399FF", "#CC33FF", "#FFCC00", "#FF3366", "#00CCCC", "#FF9933", "#FF4444", "#66FF66", "#6666FF", "#FF66FF", "#FFFFFF", "#AAAAAA"];

const WING_SYMBOLS = [
  "⬡", "◆", "▲", "★", "●", "■", "⬢", "◈",
  "⚡", "☠", "⚔", "🛡", "⚙", "☀", "✦", "♦",
  "△", "◇", "⊕", "⊗", "⌖", "✶", "⬟", "✠",
];

export function PersonnelTab({ isOwner }: { isOwner: boolean }) {
  const { ssuId, tribeId } = useGoals();
  const { wings, loading: wingsLoading, addWing, removeWing, renameWing, updateWingColor, updateWingSymbol, assignMember, unassignMember } = useWings(ssuId, tribeId);
  const { members, loading: membersLoading, addMember, removeMember } = useMembers(ssuId, tribeId);

  const [newWingName, setNewWingName] = useState("");
  const [editingWing, setEditingWing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editingColor, setEditingColor] = useState<string | null>(null);
  const [editingSymbol, setEditingSymbol] = useState<string | null>(null);

  // Character lookup state
  const [lookupAddress, setLookupAddress] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<{ name: string; characterId: number; tribeId: number; tribeName: string | null; address: string } | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);

  function handleAddWing() {
    if (!newWingName.trim()) return;
    const color = WING_COLORS[wings.length % WING_COLORS.length];
    addWing(newWingName.trim(), color);
    setNewWingName("");
  }

  async function handleLookup() {
    const addr = lookupAddress.trim();
    if (!addr) return;
    setLookupLoading(true);
    setLookupError(null);
    setLookupResult(null);
    try {
      const char = await fetchCharacter(addr);
      if (!char) {
        setLookupError("No character found for this wallet address.");
        return;
      }
      if (String(char.tribeId) !== String(tribeId)) {
        setLookupError(`Character "${char.name}" belongs to ${char.tribeName ?? `Tribe ${char.tribeId}`}, not this tribe.`);
        return;
      }
      if (members.some((m) => m.address === addr)) {
        setLookupError(`"${char.name}" is already on the roster.`);
        return;
      }
      setLookupResult({ name: char.name, characterId: char.characterId, tribeId: char.tribeId, tribeName: char.tribeName, address: addr });
    } catch {
      setLookupError("Failed to query character data. Check the address and try again.");
    } finally {
      setLookupLoading(false);
    }
  }

  function handleAddLookedUp() {
    if (!lookupResult) return;
    addMember(lookupResult.name, lookupResult.address, lookupResult.characterId);
    setLookupResult(null);
    setLookupAddress("");
  }

  // Members not in any wing
  const assignedAddresses = new Set(wings.flatMap((w) => w.memberAddresses));
  const unassigned = members.filter((m) => !assignedAddresses.has(m.address));

  if (wingsLoading || membersLoading) return <p className="muted">Loading...</p>;

  return (
    <>
      {/* Wing Management */}
      <div className="personnel-section">
        <h4>Wings</h4>
        <p className="muted" style={{ fontSize: "0.75rem", marginBottom: "0.5rem" }}>
          Organise corporation members into wings. Missions can be assigned to specific wings for visibility control.
        </p>

        {isOwner && (
        <div className="input-row" style={{ marginBottom: "0.75rem" }}>
          <input
            type="text" placeholder="New wing name" value={newWingName}
            onChange={(e) => setNewWingName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddWing()}
          />
          <button className="btn-primary" onClick={handleAddWing} disabled={!newWingName.trim()}>Add Wing</button>
        </div>
        )}

        {wings.length === 0 && <p className="muted">No wings created yet.</p>}

        <div className="wings-grid">
          {wings.map((wing) => {
            const wingMembers = members.filter((m) => wing.memberAddresses.includes(m.address));
            return (
              <div key={wing.id} className="wing-card" style={{ borderColor: wing.color }}>
                <div className="wing-card-header">
                  <span className="wing-symbol-badge" style={{ color: wing.color }}>{wing.symbol || "⬡"}</span>
                  {editingWing === wing.id ? (
                    <div className="input-row">
                      <input
                        type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { renameWing(wing.id, editName); setEditingWing(null); } }}
                        autoFocus
                      />
                      <button className="btn-primary" onClick={() => { renameWing(wing.id, editName); setEditingWing(null); }}>✓</button>
                    </div>
                  ) : (
                    <>
                      <span className="wing-name" style={{ color: wing.color }}>{wing.name}</span>
                      <span className="wing-count">{wingMembers.length} member{wingMembers.length !== 1 ? "s" : ""}</span>
                      {isOwner && <>
                      <button className="btn-subtle" onClick={() => { setEditingWing(wing.id); setEditName(wing.name); }}>✎</button>
                      <button className="btn-subtle" onClick={() => setEditingColor(editingColor === wing.id ? null : wing.id)} title="Change colour">🎨</button>
                      <button className="btn-subtle" onClick={() => setEditingSymbol(editingSymbol === wing.id ? null : wing.id)} title="Change symbol">⬡</button>
                      <button className="btn-subtle btn-subtle-danger" onClick={() => removeWing(wing.id)}>✕</button>
                      </>}
                    </>
                  )}
                </div>

                {/* Colour picker */}
                {editingColor === wing.id && (
                  <div className="wing-picker-grid">
                    {WING_COLORS.map((c) => (
                      <button
                        key={c}
                        className={`wing-color-swatch${wing.color === c ? " active" : ""}`}
                        style={{ background: c }}
                        onClick={() => { updateWingColor(wing.id, c); setEditingColor(null); }}
                        title={c}
                      />
                    ))}
                  </div>
                )}

                {/* Symbol picker */}
                {editingSymbol === wing.id && (
                  <div className="wing-picker-grid">
                    {WING_SYMBOLS.map((s) => (
                      <button
                        key={s}
                        className={`wing-symbol-swatch${(wing.symbol || "⬡") === s ? " active" : ""}`}
                        style={{ color: wing.color }}
                        onClick={() => { updateWingSymbol(wing.id, s); setEditingSymbol(null); }}
                        title={s}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}

                <div className="wing-members">
                  {wingMembers.map((m) => (
                    <div key={m.address} className="wing-member-row">
                      <span className="member-name">{m.name}</span>
                      <span className="member-addr">{m.address.slice(0, 8)}...</span>
                      {isOwner && <button className="btn-subtle btn-subtle-danger" onClick={() => unassignMember(wing.id, m.address)} title="Remove from wing">✕</button>}
                    </div>
                  ))}
                  {wingMembers.length === 0 && <p className="muted" style={{ fontSize: "0.7rem" }}>No members assigned</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Member Lookup */}
      <div className="personnel-section" style={{ marginTop: "1.5rem" }}>
        <h4>Corporation Members</h4>
        {isOwner && (<>
        <p className="muted" style={{ fontSize: "0.75rem", marginBottom: "0.5rem" }}>
          Look up corporation members by wallet address. The Frontier API verifies they belong to this tribe before adding them to the roster.
        </p>

        <div className="input-row" style={{ marginBottom: "0.5rem" }}>
          <input
            type="text" placeholder="Sui wallet address (0x...)" value={lookupAddress}
            onChange={(e) => { setLookupAddress(e.target.value); setLookupError(null); setLookupResult(null); }}
            onKeyDown={(e) => e.key === "Enter" && handleLookup()}
            style={{ flex: 1 }}
          />
          <button className="btn-primary" onClick={handleLookup} disabled={lookupLoading || !lookupAddress.trim()}>
            {lookupLoading ? "Looking up…" : "Lookup"}
          </button>
        </div>

        {lookupError && <p className="error" style={{ fontSize: "0.75rem", margin: "0.25rem 0 0.5rem" }}>{lookupError}</p>}

        {lookupResult && (
          <div className="lookup-result">
            <div className="lookup-info">
              <span className="lookup-name">{lookupResult.name}</span>
              <span className="lookup-tribe">{lookupResult.tribeName ?? `Tribe ${lookupResult.tribeId}`}</span>
              <span className="lookup-addr">{lookupResult.address.slice(0, 10)}…{lookupResult.address.slice(-6)}</span>
            </div>
            <button className="btn-primary" onClick={handleAddLookedUp}>Add to Roster</button>
          </div>
        )}
        </>)}

        {members.length === 0 && <p className="muted">No members registered yet.</p>}

        {/* Unassigned members */}
        {unassigned.length > 0 && (
          <div className="member-group">
            <h5 className="muted">Unassigned ({unassigned.length})</h5>
            {unassigned.map((m) => (
              <div key={m.address} className="member-row">
                <span className="member-name">{m.name}</span>
                <span className="member-addr">{m.address.slice(0, 10)}...</span>
                <span className="member-date">{new Date(m.joinedAt).toLocaleDateString()}</span>
                {isOwner && wings.length > 0 && (
                  <div className="wing-assign-btns">
                    {wings.map((w) => (
                      <button key={w.id} className="wing-pill" style={{ borderColor: w.color, color: w.color }}
                        onClick={() => assignMember(w.id, m.address)} title={`Assign to ${w.name}`}>
                        + {w.name}
                      </button>
                    ))}
                  </div>
                )}
                {isOwner && <button className="btn-subtle btn-subtle-danger" onClick={() => removeMember(m.address)} title="Remove member">✕</button>}
              </div>
            ))}
          </div>
        )}

        {/* Members by wing */}
        {wings.map((wing) => {
          const wingMembers = members.filter((m) => wing.memberAddresses.includes(m.address));
          if (wingMembers.length === 0) return null;
          return (
            <div key={wing.id} className="member-group">
              <h5 style={{ color: wing.color }}>{wing.name} ({wingMembers.length})</h5>
              {wingMembers.map((m) => (
                <div key={m.address} className="member-row">
                  <span className="member-name">{m.name}</span>
                  <span className="member-addr">{m.address.slice(0, 10)}...</span>
                  <span className="member-date">{new Date(m.joinedAt).toLocaleDateString()}</span>
                  {isOwner && <>
                  <button className="btn-subtle btn-subtle-danger" onClick={() => { unassignMember(wing.id, m.address); }} title="Remove from wing">
                    ✕ {wing.name}
                  </button>
                  <button className="btn-subtle btn-subtle-danger" onClick={() => removeMember(m.address)} title="Remove member">✕</button>
                  </>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </>
  );
}
