export type ActiveWorkOrder = {
  id: string;
  woNo: string;
  description: string;
  status: string;
  priority?: string;
};

export type MachineOption = {
  id: string;
  label?: string;
  code?: string;
  name?: string;
  regNo?: string;
  registrationNo?: string;
  category?: string;
  assetClass?: string;
  status?: string;
  activeWorkOrders?: ActiveWorkOrder[];
};

export type NormalizedMachine = MachineOption & {
  code: string;
  name: string;
  category: string;
  activeWorkOrders: ActiveWorkOrder[];
};

export function normalizeAssets(
  assets: (MachineOption | { id: string; label: string })[]
): NormalizedMachine[] {
  return assets.map((a) => {
    const opt = a as MachineOption;
    let code = opt.code || "";
    let name = opt.name || "";
    const category = opt.category || opt.assetClass || "General Fleet";

    if (!code && opt.label) {
      const parts = opt.label.split("—").map((p: string) => p.trim());
      if (parts.length > 1) {
        code = parts[0];
        name = parts.slice(1).join(" — ");
      } else {
        code = opt.label;
        name = opt.label;
      }
    }

    return {
      ...opt,
      id: opt.id,
      code: code || opt.id,
      name: name || opt.label || opt.id,
      category: category || "General Fleet",
      activeWorkOrders: opt.activeWorkOrders || [],
    };
  });
}

export function filterMachines(
  machines: NormalizedMachine[],
  selectedCategory: string,
  searchQuery: string
): NormalizedMachine[] {
  const q = searchQuery.trim().toLowerCase();
  return machines.filter((m) => {
    const matchesCategory =
      selectedCategory.toUpperCase() === "ALL" ||
      m.category.toLowerCase() === selectedCategory.toLowerCase();

    if (!matchesCategory) return false;

    if (!q) return true;
    const reg = (m.regNo || m.registrationNo || "").toLowerCase();
    return (
      m.code.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      reg.includes(q) ||
      m.category.toLowerCase().includes(q)
    );
  });
}
