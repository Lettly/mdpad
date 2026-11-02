import {
  useMarkraEditorSelectionAnchor,
  useMarkraEditorSelectionToolbar,
  useMarkraEditorUi,
  useMarkraEditorView,
} from "@markra/editor-react";
import type { MarkraUiAction } from "@markra/editor/codemirror";
import type { EditorView } from "@codemirror/view";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  fitCodeMirrorFloatingMenu,
  useFloatingMenuStyle,
} from "./CodeMirrorEditorFloatingMenus";
import { EditorIcon } from "./editor-icons";

export interface CodeMirrorPluginUiProps {
  pluginIds: readonly string[];
}

interface ContextMenuItem {
  enabled: boolean;
  icon?: string;
  id: string;
  label: string;
  run: () => void;
}

interface ContextMenuGroup {
  id: string;
  items: readonly ContextMenuItem[];
  label: string;
}

function preserveEditorSelection(event: ReactMouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

function itemFromAction(action: MarkraUiAction): ContextMenuItem {
  return {
    enabled: action.enabled,
    icon: action.icon,
    id: `${action.plugin}:${action.command}`,
    label: action.label,
    run: action.run,
  };
}

function writeClipboard(text: string) {
  if (!text) return;
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

function copySelection(view: EditorView) {
  const { from, to } = view.state.selection.main;
  if (from !== to) writeClipboard(view.state.sliceDoc(from, to));
}

function cutSelection(view: EditorView) {
  const { from, to } = view.state.selection.main;
  if (from === to) return;
  writeClipboard(view.state.sliceDoc(from, to));
  view.dispatch({
    changes: { from, to },
    selection: { anchor: from },
    userEvent: "delete.cut",
  });
}

async function pasteClipboard(view: EditorView) {
  const { from, to } = view.state.selection.main;
  let text = "";
  try {
    text = await navigator.clipboard.readText();
  } catch {
    // Reading the clipboard can be refused; there is nothing to paste then.
    return;
  }
  if (!text) return;
  view.dispatch({
    changes: { from, insert: text, to },
    scrollIntoView: true,
    selection: { anchor: from + text.length },
    userEvent: "input.paste",
  });
  view.focus();
}

/**
 * Right-click on the writing surface: the block commands the slash menu lists
 * (headings, lists, tables, collapsible sections, and the rest), the formatting
 * actions for a selection, link actions, uploads, and the clipboard. The menu is
 * built from every plugin's UI contributions, Markra's own included.
 */
export function CodeMirrorPluginUi({ pluginIds }: CodeMirrorPluginUiProps) {
  const view = useMarkraEditorView();
  const pluginIdSet = useMemo(() => new Set(pluginIds), [pluginIds]);
  const toolbar = useMarkraEditorUi("toolbar").filter((action) =>
    pluginIdSet.has(action.plugin));
  const selectionToolbar = useMarkraEditorSelectionToolbar();
  const selectionActions = selectionToolbar.actions.filter((action) =>
    pluginIdSet.has(action.plugin));
  const selectionAnchor = useMarkraEditorSelectionAnchor(
    selectionActions.length > 0 ? selectionToolbar.from : null,
    selectionActions.length > 0 ? selectionToolbar.to : null,
  );
  const insertActions = useMarkraEditorUi("slash-menu");
  const contextActions = useMarkraEditorUi("context-menu");
  const [contextPoint, setContextPoint] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const selection = view?.state.selection.main ?? null;
  const hasSelection = Boolean(selection && !selection.empty);
  const canPaste = Boolean(navigator.clipboard?.readText);

  const groups: ContextMenuGroup[] = [];
  const addGroup = (
    id: string,
    label: string,
    items: readonly ContextMenuItem[],
  ) => {
    const enabled = items.filter((item) => item.enabled);
    if (enabled.length > 0) groups.push({ id, items: enabled, label });
  };

  const clipboard: ContextMenuItem[] = [];
  if (view && hasSelection) {
    clipboard.push({
      enabled: true,
      icon: "scissors",
      id: "clipboard.cut",
      label: "Cut",
      run: () => cutSelection(view),
    });
    clipboard.push({
      enabled: true,
      icon: "copy",
      id: "clipboard.copy",
      label: "Copy",
      run: () => copySelection(view),
    });
  }
  if (view && canPaste) {
    clipboard.push({
      enabled: true,
      icon: "clipboard-paste",
      id: "clipboard.paste",
      label: "Paste",
      run: () => void pasteClipboard(view),
    });
  }
  // Context-menu contributions name their own group — "link" for Markra's link
  // actions, "file" for uploads — and each group keeps its contribution order.
  const contextGroups = new Map<string, ContextMenuItem[]>();
  for (const action of contextActions) {
    const id = action.group ?? "link";
    const items = contextGroups.get(id) ?? [];
    items.push(itemFromAction(action));
    contextGroups.set(id, items);
  }
  for (const [id, items] of contextGroups) {
    addGroup(id, id.charAt(0).toUpperCase() + id.slice(1), items);
  }
  if (selectionToolbar.open) {
    addGroup("format", "Format", selectionToolbar.actions.map(itemFromAction));
  }
  addGroup("clipboard", "Clipboard", clipboard);
  addGroup(
    "blocks",
    "Blocks",
    insertActions
      .filter((action) => action.group === "block" || action.group === "Blocks")
      .map(itemFromAction),
  );
  addGroup(
    "inline",
    "Inline",
    insertActions
      .filter((action) => action.group === "Inline")
      .map(itemFromAction),
  );
  addGroup(
    "insert",
    "Insert",
    insertActions
      .filter((action) => action.group === "insert")
      .map(itemFromAction),
  );

  const itemCount = groups.reduce(
    (total, group) => total + group.items.length,
    0,
  );
  const flatItems = groups.flatMap((group) => group.items);
  const contextPlacement = useFloatingMenuStyle(
    contextPoint,
    Boolean(contextPoint),
    {
      height: Math.min(itemCount * 30 + groups.length * 26 + 12, 420),
      width: 264,
    },
    groups.map((group) => `${group.id}:${group.items.length}`).join("|"),
    640,
  );

  useEffect(() => {
    if (!view) return;
    const openContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      // Right-clicking elsewhere in the document moves the caret there, the way
      // an editor does; inside an existing selection the selection is kept so
      // formatting and clipboard actions keep their target.
      const position = view.posAtCoords({
        x: event.clientX,
        y: event.clientY,
      });
      if (position !== null) {
        const current = view.state.selection.main;
        if (position < current.from || position > current.to) {
          view.dispatch({ selection: { anchor: position } });
        }
      }
      setContextPoint({ left: event.clientX, top: event.clientY });
      setActiveIndex(-1);
    };
    const closeContextMenu = (event: Event) => {
      const target = event.target instanceof Element
        ? event.target
        : event.target instanceof Node
          ? event.target.parentElement
          : null;
      if (target?.closest(".markra-plugin-context-menu")) return;
      setContextPoint(null);
    };
    view.dom.addEventListener("contextmenu", openContextMenu);
    view.dom.ownerDocument.addEventListener("pointerdown", closeContextMenu);
    view.dom.ownerDocument.addEventListener("scroll", closeContextMenu, true);
    return () => {
      view.dom.removeEventListener("contextmenu", openContextMenu);
      view.dom.ownerDocument.removeEventListener("pointerdown", closeContextMenu);
      view.dom.ownerDocument.removeEventListener("scroll", closeContextMenu, true);
    };
  }, [view]);

  const runItem = useCallback(
    (item: ContextMenuItem) => {
      setContextPoint(null);
      item.run();
      view?.focus();
    },
    [view],
  );

  // The editor keeps DOM focus while the menu is open, so the menu has to claim
  // the keys it uses before CodeMirror moves the caret with them.
  useEffect(() => {
    if (!contextPoint) return;
    const ownerDocument = view?.dom.ownerDocument;
    if (!ownerDocument) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setContextPoint(null);
        return;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex((current) => {
          const count = flatItems.length;
          if (count === 0) return -1;
          if (current < 0) return step > 0 ? 0 : count - 1;
          return (current + step + count) % count;
        });
        return;
      }
      if (event.key === "Enter" && activeIndex >= 0) {
        event.preventDefault();
        const item = flatItems[activeIndex];
        if (item) runItem(item);
        return;
      }
      // Any other key belongs to the editor; give it back.
      setContextPoint(null);
    };
    ownerDocument.addEventListener("keydown", onKeyDown, true);
    return () => ownerDocument.removeEventListener("keydown", onKeyDown, true);
  }, [activeIndex, contextPoint, flatItems, runItem, view]);
  const selectionStyle = selectionAnchor
    ? fitCodeMirrorFloatingMenu(
        { left: selectionAnchor.left - 120, top: selectionAnchor.top - 44 },
        { height: 36, width: 240 },
        { height: window.innerHeight, width: window.innerWidth },
      )
    : null;

  return (
    <>
      {toolbar.length > 0 ? (
        <div aria-label="Editor plugin toolbar" className="markra-plugin-toolbar" role="toolbar">
          {toolbar.map((action) => (
            <button
              aria-pressed={action.active}
              disabled={!action.enabled}
              key={`${action.plugin}:${action.command}`}
              onClick={() => runItem(itemFromAction(action))}
              onMouseDown={preserveEditorSelection}
              type="button"
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}

      {selectionStyle && selectionActions.length > 0 ? (
        <div
          aria-label="Editor plugin selection actions"
          className="markra-plugin-selection-toolbar"
          role="toolbar"
          style={selectionStyle}
        >
          {selectionActions.map((action) => (
            <button
              aria-pressed={action.active}
              disabled={!action.enabled}
              key={`${action.plugin}:${action.command}`}
              onClick={() => runItem(itemFromAction(action))}
              onMouseDown={preserveEditorSelection}
              type="button"
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}

      {contextPoint && contextPlacement.style ? (
        <div
          aria-label="Editor context menu"
          className="markra-plugin-context-menu"
          onContextMenu={(event) => event.preventDefault()}
          ref={contextPlacement.ref}
          role="menu"
          style={contextPlacement.style}
        >
          {groups.map((group, index) => (
            <div
              aria-label={group.label}
              className="markra-context-group"
              key={group.id}
              role="group"
            >
              {index > 0 ? (
                <div aria-hidden="true" className="markra-context-separator" />
              ) : null}
              <div aria-hidden="true" className="markra-context-group-label">
                {group.label}
              </div>
              {group.items.map((item) => (
                <button
                  className="markra-context-item"
                  data-active={activeIndex === flatItems.indexOf(item)}
                  disabled={!item.enabled}
                  key={item.id}
                  onClick={() => runItem(item)}
                  onMouseDown={preserveEditorSelection}
                  onMouseEnter={() => setActiveIndex(flatItems.indexOf(item))}
                  role="menuitem"
                  type="button"
                >
                  <span aria-hidden="true" className="markra-context-icon">
                    <EditorIcon name={item.icon} />
                  </span>
                  <span className="markra-context-label">{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
