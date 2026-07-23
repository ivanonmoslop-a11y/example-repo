# Slark Combo Design

## Goal

Add a Slark combo module to `heroes-combo`. It must automate a cursor-targeted combat sequence while a Combo Key is held, provide a separate manual Pounce helper, use selectable items, and cast Shadow Dance only when Slark's own health reaches a configured threshold.

## Scope

- Add `SlarkCombo` and `SlarkMenu` and register Slark under the Agility menu group.
- Keep Pudge and Earth Spirit modules unchanged.
- Use the enemy hero nearest to the world cursor as the combo target. A valid target is alive, visible, enemy, valid, and not an illusion.
- Add ability and item image selectors. All supported abilities and items are enabled by default.
- Add no descriptive tooltips to any Slark menu control.

## Controls

- `State`: enables the Slark module.
- `Combo Key`: while held, executes the combo against the valid target nearest the cursor.
- Abilities selector: Dark Pact, Pounce, Essence Shift, Shadow Dance.
- Items selector: the same full item set supported by Pudge, subject to their normal target/range/state checks.
- `Shadow Dance HP`: a percentage slider from 1 through 100, defaulting to 35. Shadow Dance is eligible only when Slark's own current HP percentage is less than or equal to this value while Combo Key is held.

## Manual Pounce

The module intercepts Slark's manual Pounce cast order when `State` is enabled. It replaces the submitted point with `InputManager.CursorOnWorld`, so Pounce always uses the cursor direction. This behavior is independent of Combo Key and does not auto-cast Pounce by itself.

## Combo Behavior

1. Validate hero, game state, Combo Key, target, and that Slark can act. Stop on manual non-script orders, death, invalid target, or end of game.
2. Close distance with enabled Blink or Harpoon when the target is outside the immediate spell/item range.
3. If the target has Linken's Sphere, use the first enabled, castable, in-range enemy-target breaker and wait for the next update before continuing.
4. Use enabled control, silence, amplification, and survival items only when their range and target-state rules allow them.
5. Cast Pounce at an intercept point calculated from the target's recent position samples, current velocity, Pounce cast delay, leap speed, leap distance, and target hull radius. Use the current target position as fallback when there is insufficient movement history. Do not Pounce if the intercept is beyond reachable leap distance.
6. Use Dark Pact and Essence Shift only when enabled and castable. Dark Pact is not delayed for Shadow Dance.
7. Use Shadow Dance only when enabled, castable, Combo Key is held, and Slark's HP percentage is at or below `Shadow Dance HP`.
8. Attack the target if no enabled cast is currently valid.

## Safety and Scheduling

- Submit at most one script cast or movement order per tick.
- Revalidate castability, range, immunity, invulnerability, and target state immediately before every order.
- Do not cast unit-target enemy items into magic immunity, invulnerability, untargetability, or an active Linken's Sphere except for the selected Linken breaker.
- Respect Pounce range and avoid issuing a predicted leap that cannot physically reach its point.

## Verification

- Add focused pure-function tests for Pounce intercept calculation: stationary target, straight movement, insufficient history fallback, and out-of-range rejection.
- Confirm the manual Pounce order selects the cursor point with Combo Key released.
- Confirm Shadow Dance triggers at 35% and below, and does not trigger at 36%.
- Confirm Linken's Sphere is broken before a following targeted item or control.
- Run ESLint for Slark files and TypeScript validation for the project.
