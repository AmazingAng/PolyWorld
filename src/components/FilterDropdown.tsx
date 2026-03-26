"use client";

import { useState, useRef, useEffect } from "react";
import { useI18n } from "@/i18n";

export interface FilterGroup {
  label: string;
  options: { key: string; label: string; color?: string }[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
  /** Single-select mode: hides "All", shows radio dots, enforces one selection */
  exclusive?: boolean;
}

interface FilterDropdownProps {
  groups: FilterGroup[];
  /** Text shown inside the trigger button alongside the filter icon */
  label?: string;
}

function isAllSelected(group: FilterGroup) {
  return group.selected.size === 0 || group.selected.size === group.options.length;
}

export default function FilterDropdown({ groups, label }: FilterDropdownProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const hasFilter = groups.some((g) =>
    g.exclusive ? g.selected.size > 0 : !isAllSelected(g)
  );

  const toggle = (group: FilterGroup, key: string) => {
    if (group.exclusive) {
      group.onChange(new Set([key]));
      return;
    }
    const next = new Set(group.selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    if (next.size === group.options.length) next.clear();
    group.onChange(next);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex items-center gap-0.5 px-1 py-0 text-[10px] rounded transition-colors leading-[16px]"
        style={{
          background: hasFilter ? "rgba(34,197,94,0.15)" : "transparent",
          color: hasFilter ? "#22c55e" : "var(--text-faint)",
          border: `1px solid ${hasFilter ? "rgba(34,197,94,0.3)" : "var(--border-subtle, #333)"}`,
        }}
        title={t("common.filter")}
      >
        {label && <span className="text-[10px]">{label}</span>}
        <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          {label
            ? <path d="M4 6l4 4 4-4" />
            : <path d="M1 3h14M3 8h10M5 13h6" />
          }
        </svg>
        {!label && hasFilter && (
          <span>{groups.reduce((n, g) => n + (g.exclusive ? g.selected.size : isAllSelected(g) ? 0 : g.selected.size), 0)}</span>
        )}
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-1 bg-[#0a0a0a]/95 border border-[#2a2a2a] py-1 backdrop-blur-sm shadow-lg animate-fade-in font-mono z-[200]"
        >
          <div className="flex gap-0" style={{ minWidth: groups.length > 1 ? 220 : 120 }}>
            {groups.map((group, gi) => (
              <div key={group.label} className={`flex-1 ${gi > 0 ? "border-l border-[#2a2a2a]" : ""}`}>
                {/* Group header */}
                <div className="px-2 py-[2px] text-[8px] font-bold uppercase tracking-wider text-[var(--text-ghost)]">
                  {group.label}
                </div>

                {/* All toggle — hidden for exclusive groups */}
                {!group.exclusive && (
                  <button
                    onClick={() => group.onChange(new Set())}
                    className="flex items-center gap-1.5 w-full text-left px-2 py-[3px] text-[10px] hover:bg-[#fff]/5 transition-colors"
                    style={{ color: isAllSelected(group) ? "#22c55e" : "var(--text-muted)" }}
                  >
                    <Checkbox checked={isAllSelected(group)} />
                    {t("filterDropdown.all")}
                  </button>
                )}

                {/* Options */}
                {group.options.map((opt) => {
                  const checked = group.exclusive
                    ? group.selected.has(opt.key)
                    : isAllSelected(group) || group.selected.has(opt.key);
                  return (
                    <button
                      key={opt.key}
                      onClick={() => toggle(group, opt.key)}
                      className="flex items-center gap-1.5 w-full text-left px-2 py-[3px] text-[10px] hover:bg-[#fff]/5 transition-colors whitespace-nowrap"
                      style={{ color: checked ? (opt.color || "var(--text-secondary)") : "var(--text-ghost)" }}
                    >
                      {group.exclusive ? <Radio checked={checked} /> : <Checkbox checked={checked} />}
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      className="w-[10px] h-[10px] rounded-sm border flex items-center justify-center shrink-0"
      style={{
        borderColor: checked ? "#22c55e" : "#555",
        background: checked ? "rgba(34,197,94,0.2)" : "transparent",
      }}
    >
      {checked && (
        <svg width="7" height="7" viewBox="0 0 12 12" fill="none" stroke="#22c55e" strokeWidth="2">
          <polyline points="2 6 5 9 10 3" />
        </svg>
      )}
    </span>
  );
}

function Radio({ checked }: { checked: boolean }) {
  return (
    <span
      className="w-[10px] h-[10px] rounded-full border flex items-center justify-center shrink-0"
      style={{
        borderColor: checked ? "#22c55e" : "#555",
        background: "transparent",
      }}
    >
      {checked && (
        <span className="w-[5px] h-[5px] rounded-full" style={{ background: "#22c55e" }} />
      )}
    </span>
  );
}
