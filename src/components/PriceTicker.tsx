import { useVaultData } from "../hooks/useVaultData";
import { useCharacter } from "../hooks/useCharacter";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useVaultId } from "../hooks/useVaultId";
import { TRIBE_ID, CREDIT_MULTIPLIER } from "../config";
import { useTribeTax } from "../hooks/useTribeTax";
import { useTicker } from "../context/DeploymentContext";

/** Scrolling bottom ticker showing tribe credit value & backing ratio. */
export function PriceTicker() {
  const account = useCurrentAccount();
  const { data: character } = useCharacter(account?.address);
  const { data: vaultId } = useVaultId(character?.tribeId);
  const { data: vault } = useVaultData(vaultId);
  const { taxPct } = useTribeTax(String(character?.tribeId ?? TRIBE_ID));
  const ticker = useTicker();

  if (!vault) return null;

  const tribeName = character?.tribeName ?? `Tribe ${character?.tribeId ?? TRIBE_ID}`;
  const supply = (vault.creditSupply / 1e9).toLocaleString();
  const backing = (vault.eveBacking / 1e9).toLocaleString();

  const items = (
    <>
      <span className="ticker-item ticker-tribe">{tribeName}</span>
      <span className="ticker-separator">|</span>
      <span className="ticker-item">1 EVE = {CREDIT_MULTIPLIER} {ticker}</span>
      <span className="ticker-separator">|</span>
      <span className="ticker-item">{taxPct}% tribe tax</span>
      <span className="ticker-separator">|</span>
      <span className="ticker-item">Supply: {supply} {ticker}</span>
      <span className="ticker-separator">|</span>
      <span className="ticker-item">Backing: {backing} EVE</span>
      <span className="ticker-separator">|</span>
    </>
  );

  return (
    <div className="ticker-bar">
      <div className="ticker-track">
        <span className="ticker-content">{items}{items}{items}{items}</span>
        <span className="ticker-content">{items}{items}{items}{items}</span>
      </div>
    </div>
  );
}
