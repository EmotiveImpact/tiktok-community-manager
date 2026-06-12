# TikTok Community Manager Layout Improvements

## Critique

1. The current dashboard is too dark and too flat. Panels, page background, sidebar, and cards all sit in nearly the same navy value, so hierarchy depends on text instead of surface depth. The target mockups use clearer planes, brighter card tops, richer shadows, and intentional right-rail contrast.

2. Spacing is loose in some places and cramped in others. Dashboard metric cards are oversized relative to their content, while table rows and live feed messages have inconsistent internal padding. Adopt a strict 4/8px rhythm: 12px component gaps, 16px panel padding, 20-24px page gutters.

3. Brand color is overused as a large navigation fill and underused as precision detail. Pink should carry primary actions, selected states, alert moments, and tiny data emphasis. Cyan should support secondary status, not compete with pink.

4. The current dashboard lacks a strong center of gravity. The target dashboard makes the "after tonight's LIVE" follow-up module the operational hero. Current dashboard cards are useful, but the eye lands everywhere at once.

5. Live view is functionally good but visually monotonous. The feed, side nav, and memory panel are all similar darkness. Pinned/top supporter events should feel materially different from normal chat, and gift/follow system events need stronger horizontal treatment.

6. Followers CRM is clean but too spreadsheet-flat. The table should feel dense and professional without becoming gray: stronger header rhythm, clearer selected/bulk state, row hover depth, and a right-side preview drawer for selected fans.

7. Typography needs sharper scale. Current headings, section titles, table text, and metadata are too close in weight and size. Use 22px page titles, 18px section titles, 13-14px body/table text, 11-12px metadata, and heavier numeric metrics.

8. Polish gaps: borders are too uniform, shadows are too generic, selected nav states are bulky, and hover states lack micro-feedback. Add 1px low-alpha borders, subtle top highlights, gradient hairlines, and one-pixel movement on clickable cards/buttons.

## Implementation Changes

1. Standardize core color tokens.

```css
:root {
  --brand-pink: #EE1D52;
  --brand-pink-hover: #ff3b78;
  --brand-cyan: #69C9D0;
  --sidebar: #050816;
  --window-bg: #070B17;
  --panel-bg: rgba(9, 14, 29, 0.86);
  --panel-bg-strong: #0B1020;
  --panel-border: rgba(255, 255, 255, 0.105);
  --text-primary: #F6F7FB;
  --text-secondary: #9AA3B8;
}
```

2. Replace generic glass panels with a reusable app panel.

```css
.app-panel {
  border: 1px solid var(--panel-border);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.022));
  box-shadow: 0 24px 70px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.045);
}
```

Tailwind: `rounded-[18px] border border-white/[0.105] bg-white/[0.035] shadow-[0_24px_70px_rgba(0,0,0,.42),inset_0_1px_0_rgba(255,255,255,.045)]`.

3. Tighten the shell grid.

```tsx
<div className="grid h-screen grid-cols-[230px_minmax(0,1fr)_320px] bg-[#070B17]">
```

Use `230px` sidebar, `320px` dashboard right rail, `304px` live memory rail, `20px` main content gutters.

4. Dashboard cards: reduce height, increase numeric contrast.

Use `grid-cols-4 gap-3`, card padding `18px`, min height `156px`, icon `44px`, label `12px/700`, metric `29px/880`, trend `12px/780`.

```tsx
className="relative min-h-[156px] rounded-[18px] border border-white/[0.105] p-[18px] before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:bg-gradient-to-r before:from-[#EE1D52] before:to-[#69C9D0]"
```

5. Make the follow-up module the dashboard hero.

Grid: `grid-cols-[120px_minmax(0,1fr)_auto]`, gap `20px`, padding `20px`, radius `20px`. Inner stat tiles: `grid-cols-4 gap-2`, height `52px`, padding `9px 12px`.

6. Sidebar selected state should be compact and confident.

Nav item: height `38-42px`, radius `12px`, horizontal padding `14px`. Active state: `bg-gradient-to-br from-[#EE1D52] to-[#ff467b] shadow-[0_12px_28px_rgba(238,29,82,.32)]`.

7. Live feed should distinguish three message types.

Normal row: `min-h-[48px] px-2.5 py-2 rounded-xl border border-transparent hover:bg-white/[.035]`.

Pinned/top supporter: `bg-gradient-to-r from-[#EE1D52]/15 to-[#EE1D52]/[.045] border-[#EE1D52]/25`.

System gift/follow event: height `30px`, radius `9px`, `bg-[#EE1D52]/12`, `border-[#EE1D52]/25`.

8. Live tabs need pill hierarchy.

Container height `54px`, padding `0 12px`, gap `8px`, radius top `18px`. Active tab height `30px`, radius `999px`, background pink gradient, shadow `0 10px 26px rgba(238,29,82,.32)`.

9. Fan memory panel should be visibly premium.

Use a gradient top border, centered avatar, compact stats, then action stack. Panel padding `16px`, radius `18px`, top border `3px`, metric cards `1fr 1fr`, gap `8px`.

10. Followers table density and rhythm.

CRM shell height should fill available page space. Filter bar `66px`, bulk bar `44px`, footer `52px`. Row height `49px`; header height `34px`; cell horizontal padding `14px`.

```tsx
<div className="grid h-[calc(100vh-126px)] grid-rows-[66px_44px_minmax(0,1fr)_52px] rounded-[20px] border border-white/[0.105] bg-[#090E1D]/85">
```

11. Followers selected state should become a visible working mode.

Bulk bar: `bg-gradient-to-r from-[#EE1D52]/10 to-[#69C9D0]/[.055] border-b border-white/[0.105]`. Show selected count, tag input, add/remove buttons, clear action.

12. Add selected-fan preview drawer on wide CRM layouts.

Width `300px`, top aligned with CRM shell, radius `18px`, cover height `54px`, avatar `58px`, stat grid `repeat(3, 1fr)`. Keep it hidden below `1280px`.

13. Table text rules.

Fan name `13px/750`, username `11px` secondary, diamonds `13px/900 tabular-nums`, tags `10px/900`, metadata `12px secondary`.

14. Buttons.

Primary: height `32-36px`, radius `999px`, pink gradient, white text, `font-weight: 800`, shadow `0 12px 30px rgba(238,29,82,.34)`. Secondary: navy fill `#141B2E`, 1px border, same radius.

15. Hover micro-detail.

Cards and buttons should move `translateY(-1px)` and brighten by `filter: brightness(1.08)`. Table rows should not move; use background only to avoid visual jitter.

16. Avoid one-note navy.

Keep the base navy, but add small amounts of pink/cyan through top rules, badges, avatars, and selected state. Do not make large cyan panels; it should remain a supporting signal.
