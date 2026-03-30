import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type RecipeData,
  setCustomRecipes,
  getCustomRecipes,
} from "../data/supplyChain";

async function fetchRecipes(): Promise<RecipeData> {
  const res = await fetch("/api/recipes?id=global");
  const data = await res.json();
  const recipes: RecipeData = {
    construction: Array.isArray(data?.construction) ? data.construction : [],
    industry: Array.isArray(data?.industry) ? data.industry : [],
    refining: Array.isArray(data?.refining) ? data.refining : [],
    gather: Array.isArray(data?.gather) ? data.gather : [],
    shipbuilding: Array.isArray(data?.shipbuilding) ? data.shipbuilding : [],
    assembly: Array.isArray(data?.assembly) ? data.assembly : [],
  };
  // Sync into the module-level runtime data
  setCustomRecipes(recipes);
  return recipes;
}

async function saveRecipes(recipes: RecipeData): Promise<void> {
  await fetch("/api/recipes?id=global", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(recipes),
  });
  setCustomRecipes(recipes);
}

export function useRecipes() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["recipes"],
    queryFn: fetchRecipes,
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: saveRecipes,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recipes"] }),
  });

  return {
    recipes: data ?? getCustomRecipes(),
    loading: isLoading,
    save: mutation.mutateAsync,
    saving: mutation.isPending,
  };
}
