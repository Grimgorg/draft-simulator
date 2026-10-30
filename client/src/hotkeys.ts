export interface Hotkey {
  keys: string;
  action: string;
}

/** Every keyboard shortcut, as listed by the hotkey info button. Add new ones here. */
export const HOTKEYS: Hotkey[] = [{ keys: "Ctrl (⌘ on Mac) + drag", action: "Take just that card out of its stack" }];
