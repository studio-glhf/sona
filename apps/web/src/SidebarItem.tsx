import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
export type ItemKind = "agents" | "studies" | "sessions";
export type ItemPreference = { name?: string; pinned?: boolean };
export type SidebarPreferences = Record<string, ItemPreference>;
export const itemLabel = (
  kind: ItemKind,
  item: any,
  preferences: SidebarPreferences,
) =>
  preferences[`${kind}:${item.id}`]?.name ??
  item.name ??
  `Session ${item.id.slice(0, 6)}`;
export function sortedItems<T extends { id: string }>(
  items: T[],
  kind: ItemKind,
  preferences: SidebarPreferences,
) {
  return [...items].sort(
    (a, b) =>
      Number(Boolean(preferences[`${kind}:${b.id}`]?.pinned)) -
      Number(Boolean(preferences[`${kind}:${a.id}`]?.pinned)),
  );
}
export function SidebarItem({
  name,
  selected,
  pinned,
  icon,
  detail,
  onSelect,
  onAction,
}: {
  name: string;
  selected?: boolean;
  pinned?: boolean;
  icon: ReactNode;
  detail?: string;
  onSelect: () => void;
  onAction: (action: "rename" | "pin" | "delete") => void;
}) {
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null),
    menu = useRef<HTMLDivElement>(null);
  const close = () => {
    setPosition(null);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!position) return;
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const dismiss = (e: PointerEvent) => {
      if (
        !menu.current?.contains(e.target as Node) &&
        !trigger.current?.contains(e.target as Node)
      )
        setPosition(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    const resize = () => setPosition(null);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", resize);
    };
  }, [position]);
  return (
    <div className={`sidebar-item ${selected ? "is-selected" : ""}`}>
      <button
        className="sidebar-select"
        onClick={onSelect}
        title={name}
        aria-current={selected ? "page" : undefined}
      >
        {icon}
        <span className="sidebar-label">
          {name}
          {detail && <small>{detail}</small>}
        </span>
        {pinned && (
          <Pin size={12} className="pin-indicator" aria-label="Pinned" />
        )}
      </button>
      <button
        ref={trigger}
        className="item-more"
        aria-label={`Actions for ${name}`}
        aria-haspopup="menu"
        aria-expanded={Boolean(position)}
        onClick={() => {
          if (position) {
            close();
            return;
          }
          const rect = trigger.current!.getBoundingClientRect();
          setPosition({
            top: Math.max(
              8,
              Math.min(rect.bottom + 4, window.innerHeight - 156),
            ),
            left: Math.max(
              8,
              Math.min(rect.right - 180, window.innerWidth - 188),
            ),
          });
        }}
      >
        <MoreHorizontal size={17} />
      </button>
      {position &&
        createPortal(
          <div
            className="item-menu"
            role="menu"
            aria-label={`Actions for ${name}`}
            ref={menu}
            style={position}
            onKeyDown={(e) => {
              if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                const buttons = Array.from(
                  menu.current!.querySelectorAll<HTMLButtonElement>("button"),
                );
                const index = buttons.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                buttons[
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? buttons.length - 1
                      : (index +
                          (e.key === "ArrowDown" ? 1 : -1) +
                          buttons.length) %
                        buttons.length
                ].focus();
              }
              if (e.key === "Tab") setPosition(null);
            }}
          >
            <button
              role="menuitem"
              onClick={() => {
                close();
                onAction("rename");
              }}
            >
              <Pencil size={16} />
              Rename
            </button>
            <button
              role="menuitem"
              onClick={() => {
                close();
                onAction("pin");
              }}
            >
              {pinned ? <PinOff size={16} /> : <Pin size={16} />}{" "}
              {pinned ? "Unpin" : "Pin to top"}
            </button>
            <div className="menu-divider" />
            <button
              role="menuitem"
              className="menu-delete"
              onClick={() => {
                close();
                onAction("delete");
              }}
            >
              <Trash2 size={16} />
              Delete
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
