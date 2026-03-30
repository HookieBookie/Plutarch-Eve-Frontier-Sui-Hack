import { useRecipes } from "../../hooks/useRecipes";
import { RecipeEditor } from "../RecipeEditor";

export function BlueprintsTab() {
  // Load custom recipes on mount so getBuildings() includes them
  useRecipes();

  return (
    <>
      <p className="muted" style={{ fontSize: "0.75rem", marginBottom: "0.75rem" }}>
        Add buildings, manufacturing, refining and gather entries so missions auto-decompose.
      </p>
      <RecipeEditor />
    </>
  );
}
