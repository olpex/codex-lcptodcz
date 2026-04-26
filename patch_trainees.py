import sys
import re

with open("frontend/src/pages/TraineesPage.tsx", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Add Group type import if missing
if "type { Trainee, Group }" not in content:
    content = content.replace("type { Trainee }", "type { Trainee, Group }")

# 2. Add groups state
groups_state_code = """
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
"""
content = content.replace("const [trainees, setTrainees] = useState<Trainee[]>([]);", groups_state_code)

# 3. Add fetchGroups
fetch_groups_code = """
  const fetchTrainees = async (term = "") => {
    setIsLoading(true);
    try {
      const [groupsData, data] = await Promise.all([
        request<Group[]>("/groups"),
        (async () => {
          const params = new URLSearchParams();
          if (term.trim()) {
            params.set("search", term.trim());
          }
          if (showArchived) {
            params.set("include_deleted", "true");
          }
          const query = params.toString() ? `?${params.toString()}` : "";
          return request<Trainee[]>(`/trainees${query}`);
        })()
      ]);
      setGroups(groupsData);
      setTrainees(data);
      setSelected((prev) => {
"""

content = re.sub(r'const fetchTrainees = async \(term = ""\) => \{[\s\S]*?const data = await request<Trainee\[\]>\(`/trainees\$\{query\}`\);\n\s*setTrainees\(data\);\n\s*setSelected\(\(prev\) => \{', fetch_groups_code.strip() + "\n        const next: Record<number, boolean> = {};", content)

# 4. Add deleteGroup logic
delete_group_code = """
  const [groupToDelete, setGroupToDelete] = useState<Group | null>(null);

  const confirmDeleteGroup = async () => {
    if (!groupToDelete) return;
    try {
      await request(`/groups/${groupToDelete.id}?delete_trainees=true`, { method: "DELETE" });
      setGroupToDelete(null);
      showSuccess("Групу та її слухачів успішно видалено");
      fetchTrainees(search);
    } catch (error) {
      showError((error as Error).message);
    }
  };

  const handleGroupDeleteClick = (groupCode: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const groupObj = groups.find(g => g.code === groupCode);
    if (groupObj) {
      setGroupToDelete(groupObj);
    } else {
      showError("Групу не знайдено в базі даних (можливо, це віртуальна група).");
    }
  };
"""
content = content.replace("const createTrainee =", delete_group_code + "\n  const createTrainee =")

# 5. Add Delete Button to group header
group_header_code = """
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 bg-slate-50 px-3 py-2 text-left"
                  onClick={() => toggleGroupExpanded(group.key)}
                  aria-expanded={groupExpanded}
                >
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      Група: {group.label}
                    </p>
                    <p className="truncate text-xs text-slate-600">
                      Слухачів: {group.trainees.length}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {canEdit && group.key !== "__no_group__" && groups.some(g => g.code === group.key) && (
                      <button
                        type="button"
                        className="rounded bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-200"
                        onClick={(e) => handleGroupDeleteClick(group.key, e)}
                      >
                        🗑 Видалити групу
                      </button>
                    )}
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-pine text-white font-bold">
                      {groupExpanded ? "−" : "+"}
                    </span>
                  </div>
                </button>
"""
content = re.sub(r'<button\n\s*type="button"\n\s*className="flex w-full items-center justify-between gap-3 bg-slate-50 px-3 py-2 text-left"\n\s*onClick=\{[^}]+\}\n\s*aria-expanded=\{groupExpanded\}\n\s*>\n\s*<div className="min-w-0">\n\s*<p className="truncate text-sm font-semibold text-slate-900">\n\s*Група: \{group\.label\}\n\s*</p>\n\s*<p className="truncate text-xs text-slate-600">\n\s*Слухачів: \{group\.trainees\.length\}\n\s*</p>\n\s*</div>\n\s*<span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-pine text-white font-bold">\n\s*\{groupExpanded \? "−" : "\+"\}\n\s*</span>\n\s*</button>', group_header_code.strip(), content)

# 6. Add ConfirmDialog at the bottom
confirm_dialog_code = """
      </Panel>
      <ConfirmDialog
        isOpen={groupToDelete !== null}
        title="Видалення групи"
        description={`Ви впевнені, що хочете видалити групу "${groupToDelete?.name || groupToDelete?.code}"? Це також відправить в архів усіх слухачів, які до неї належать.`}
        confirmLabel="Видалити групу та слухачів"
        cancelLabel="Скасувати"
        isDestructive
        onConfirm={confirmDeleteGroup}
        onCancel={() => setGroupToDelete(null)}
      />
    </div>
"""
content = content.replace("      </Panel>\n    </div>", confirm_dialog_code)

with open("frontend/src/pages/TraineesPage.tsx", "w", encoding="utf-8") as f:
    f.write(content)

print("TraineesPage updated successfully.")
