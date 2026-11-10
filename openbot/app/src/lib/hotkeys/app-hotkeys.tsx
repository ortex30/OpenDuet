import { useNavigate } from "@tanstack/react-router";
import { useHotkey } from "./use-hotkey";

/**
 * The app-wide shortcuts, bound once for the whole signed-in app.
 *
 * NOT MOUNTED in Academic OS. The app is one chat, and Shift+N, pressed anywhere outside the message
 * box, only left it for an empty new-conversation screen. To bring the shortcuts back, mount this in
 * `_authed`'s route component, where the whole signed-in tree hangs, so they work on settings and
 * admin too. Renders nothing; it exists to be a component because binding needs hooks.
 */
export function AppHotkeys() {
  const navigate = useNavigate();

  // Same destination as the sidebar's + button: the new-channel composer.
  useHotkey("new-chat", () => {
    navigate({ to: "/channel/new" });
  });

  return null;
}
