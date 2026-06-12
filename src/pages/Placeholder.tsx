/** Placeholder pages for CRM features being absorbed from the web app.
 *  A later agent replaces these with real pages. */

const PAGES = {
  followers: {
    title: 'Followers',
    desc: 'Your full fan CRM — profiles, tags, birthdays and notes — is coming online here.',
    icon: './assets/png/icon_group_3d.png',
  },
  gifts: {
    title: 'Gifts',
    desc: 'Log and review every gift across your LIVEs to know exactly who to thank.',
    icon: './assets/png/icon_gift_box_3d.png',
  },
  reminders: {
    title: 'Reminders',
    desc: 'Birthday nudges and follow-up reminders will land here so no fan gets forgotten.',
    icon: './assets/png/icon_thank_you_envelope_3d.png',
  },
  import: {
    title: 'Import',
    desc: 'Bring follower lists and gift logs in from CSV exports — coming online here.',
    icon: './assets/png/icon_star_award_3d.png',
  },
  settings: {
    title: 'Settings',
    desc: 'A full settings page is on its way. For now, use the gear icon in the top bar.',
    icon: './assets/png/icon_clock_3d.png',
  },
} as const;

export type PlaceholderId = keyof typeof PAGES;

export function PlaceholderPage({ id }: { id: PlaceholderId }) {
  const p = PAGES[id];
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="glass flex max-w-md flex-col items-center px-10 py-12 text-center" style={{ borderRadius: 22 }}>
        <img src={p.icon} alt="" className="mb-4 h-20 w-20 object-contain" draggable={false} />
        <h1 className="text-lg font-extrabold tracking-tight">{p.title} — coming online here</h1>
        <p className="mt-2 text-[13px] leading-relaxed" style={{ color: 'var(--secondary-label)' }}>{p.desc}</p>
      </div>
    </div>
  );
}
