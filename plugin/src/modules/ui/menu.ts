import { PLUGIN_ID } from "../reader/bridge.js";

export type FullTranslationCommand = (
  items: Zotero.Item[],
) => void | Promise<void>;

export interface MenuRegistration {
  dispose(): void;
}

export const FULL_TRANSLATION_MENU_ID = "zut-translate-full";
const MENU_ICON = "chrome://zut/content/icons/zut-icon-48.png";

function menuLabel(): string {
  return "ZUT";
}

function fullTranslationLabel(): string {
  return Zotero.locale.startsWith("zh")
    ? "ZUT: 翻译 PDF"
    : "ZUT: Translate PDF";
}

function selectedItems(items?: Zotero.Item[]): Zotero.Item[] {
  return items ?? Zotero.getActiveZoteroPane()?.getSelectedItems() ?? [];
}

export function registerItemMenu(
  command: FullTranslationCommand,
): MenuRegistration {
  const registration = Zotero.MenuManager.registerMenu({
    menuID: FULL_TRANSLATION_MENU_ID,
    pluginID: PLUGIN_ID,
    target: "main/library/item",
    menus: [
      {
        menuType: "submenu",
        icon: MENU_ICON,
        onShowing(_event, context) {
          context.menuElem.setAttribute("label", menuLabel());
          context.setVisible(true);
          context.setEnabled(selectedItems(context.items).length === 1);
        },
        menus: [
          {
            menuType: "menuitem",
            icon: MENU_ICON,
            onShowing(_event, context) {
              context.menuElem.setAttribute("label", fullTranslationLabel());
              context.setEnabled(selectedItems(context.items).length === 1);
            },
            onCommand(_event, context) {
              void command(selectedItems(context.items));
            },
          },
        ],
      },
    ],
  });
  return {
    dispose() {
      if (registration !== false) {
        Zotero.MenuManager.unregisterMenu(FULL_TRANSLATION_MENU_ID);
      }
    },
  };
}
