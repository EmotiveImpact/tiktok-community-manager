import { useStore } from '../state/store';
import { useModeration } from '../state/moderation';
import { avatarGradient } from '../lib/avatars';
import { Username } from './Username';
import { timeAgo } from '../lib/format';

export function QuestionFeed() {
  const questions = useStore((s) => s.questions);
  const isFiltered = useModeration((s) => s.isFiltered);

  if (questions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-600">
        No Q&amp;A questions yet
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2 p-3">
      {questions.map((q) => {
        if (q.type !== 'questionNew') return null;
        if (isFiltered(q.user.uniqueId, q.question)) return null;
        return (
          <li
            key={q.id}
            className="rounded-lg border border-violet-500/10 bg-violet-500/5 px-3 py-2.5"
          >
            <div className="flex items-center gap-2">
              {q.user.profilePictureUrl ? (
                <img src={q.user.profilePictureUrl} alt="" className="h-6 w-6 flex-none rounded-full bg-zinc-800 object-cover" />
              ) : (
                <div className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-[10px] font-bold text-white ${avatarGradient(q.user.nickname)}`}>
                  {q.user.nickname.charAt(0).toUpperCase()}
                </div>
              )}
              <Username user={q.user} className="text-xs font-semibold" />
              <span className="text-[10px] text-zinc-600">{timeAgo(q.ts)}</span>
            </div>
            <div className="mt-1.5 break-words text-[13px] text-zinc-200">{q.question}</div>
          </li>
        );
      })}
    </ul>
  );
}
