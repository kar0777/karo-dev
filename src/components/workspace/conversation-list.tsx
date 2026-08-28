'use client';

import { Check, EllipsisVertical, MessageSquare, Plus, Search, X } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { apiFetch, describeError } from '@/lib/client/api';
import { cn, formatCompactNumber, formatMicroUsd, formatRelativeTime } from '@/lib/utils';

import { useWorkspace } from './workspace-context';

/**
 * Chat history: search, rename, delete, new chat.
 *
 * Search has two tiers. Typing filters the loaded titles instantly, which is
 * what you want when you half-remember the name of a chat from this morning.
 * From two characters up, the same query also goes to
 * `GET /api/conversations/search`, which reads message *bodies* — that is the
 * only way to find the conversation where you pasted a stack trace, and it is
 * team-scoped server-side. Results are narrowed to this project so the sidebar
 * never offers a chat that switching to would navigate away from.
 */

/** The endpoint rejects anything shorter, so there is no point asking. */
const MIN_QUERY = 2;
const DEBOUNCE_MS = 220;

type SearchHit = {
  conversationId: string;
  conversationTitle: string;
  matchedIn: 'title' | 'message';
  role: string | null;
  snippet: string;
  updatedAt: string | null;
};

type SearchResponse = { results?: SearchHit[] };

/** What the last completed request produced, tagged with the query it answered. */
type SearchState = { query: string; hits: SearchHit[] | null; error: string | null };

const IDLE: SearchState = { query: '', hits: null, error: null };

/**
 * Debounced body search against the shared endpoint.
 *
 * Two deliberate shapes here. Results are *tagged* with the query that produced
 * them and read back only when the tag still matches what is typed, so stale
 * hits never have to be cleared — clearing state from an effect is what causes
 * the cascading renders the compiler rules forbid. And every keystroke aborts
 * the previous request: with substring matching over a long transcript the
 * shorter prefix is often the slower query, so "last response wins" would
 * happily overwrite the answer to what the user actually typed.
 */
function useConversationSearch(projectId: string, query: string) {
  const [state, setState] = React.useState<SearchState>(IDLE);
  const [busy, setBusy] = React.useState(false);
  const latestRequest = React.useRef(0);

  const needle = query.trim();
  const enabled = needle.length >= MIN_QUERY;

  React.useEffect(() => {
    if (!enabled) return;

    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;
    const controller = new AbortController();

    // `busy` flips inside the timer rather than in the effect body: it is only
    // true while a request is genuinely open, and it keeps this effect free of
    // synchronous state updates.
    const timer = setTimeout(() => {
      setBusy(true);
      void apiFetch<SearchResponse>(
        `/api/conversations/search?q=${encodeURIComponent(needle)}&projectId=${encodeURIComponent(projectId)}`,
        { signal: controller.signal },
      )
        .then((payload) => {
          if (latestRequest.current !== requestId) return;
          setState({ query: needle, hits: payload.results ?? [], error: null });
        })
        .catch((caught: unknown) => {
          if (latestRequest.current !== requestId) return;
          if (caught instanceof DOMException && caught.name === 'AbortError') return;
          setState({ query: needle, hits: null, error: describeError(caught).message });
        })
        .finally(() => {
          if (latestRequest.current === requestId) setBusy(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, needle, projectId]);

  const fresh = enabled && state.query === needle;
  return {
    hits: fresh ? state.hits : null,
    error: fresh ? state.error : null,
    busy: enabled && busy,
  };
}

export function ConversationList({ onPick }: { onPick?: () => void }) {
  const {
    data,
    conversations,
    activeConversationId,
    selectConversation,
    createConversation,
    renameConversation,
    deleteConversation,
  } = useWorkspace();

  const [query, setQuery] = React.useState('');
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');

  const { hits, busy, error } = useConversationSearch(data.project.id, query);

  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter((conversation) =>
      conversation.title.toLowerCase().includes(needle),
    );
  }, [conversations, query]);

  // Only body matches are worth a second section: a title match is already in
  // the list above it, and showing it twice reads as a bug.
  const bodyHits = React.useMemo(
    () =>
      (hits ?? []).filter(
        (hit) =>
          hit.matchedIn === 'message' &&
          !filtered.some((conversation) => conversation.id === hit.conversationId),
      ),
    [filtered, hits],
  );

  function commitRename(id: string) {
    if (draft.trim()) renameConversation(id, draft);
    setRenamingId(null);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 border-b border-line px-2 py-2">
        <div className="relative min-w-0 flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-subtle"
          />
          <Input
            inputSize="sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('');
            }}
            placeholder="Search titles and messages"
            aria-label="Search conversations by title or message text"
            aria-describedby="conversation-search-hint"
            className="pr-7 pl-7"
          />
          {busy ? (
            <Spinner
              size="xs"
              label={null}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-subtle"
            />
          ) : query ? (
            <Button
              size="icon-sm"
              variant="ghost"
              className="absolute top-1/2 right-0.5 size-6 -translate-y-1/2"
              aria-label="Clear search"
              onClick={() => setQuery('')}
            >
              <X className="size-3" />
            </Button>
          ) : null}
        </div>
        <Button
          size="icon-sm"
          variant="secondary"
          aria-label="New chat"
          onClick={() => {
            createConversation();
            onPick?.();
          }}
        >
          <Plus className="size-3.5" />
        </Button>
      </div>

      <p id="conversation-search-hint" className="px-2 pt-1.5 text-[10.5px] text-subtle">
        {error
          ? error
          : query.trim().length === 0
            ? 'Filters titles as you type. Two characters or more also searches message text.'
            : query.trim().length < MIN_QUERY
              ? 'Type one more character to search inside messages.'
              : hits === null
                ? // No settled result for what is currently typed — during the
                  // debounce as much as during the request. Reporting "0 in
                  // messages" here would be a claim the search has not made yet.
                  'Searching message text…'
                : `${filtered.length} title ${filtered.length === 1 ? 'match' : 'matches'}, ${bodyHits.length} in messages`}
      </p>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {filtered.length === 0 && bodyHits.length === 0 ? (
          <EmptyState
            size="sm"
            icon={MessageSquare}
            title={query ? 'Nothing matched' : 'No conversations yet'}
            description={
              query
                ? 'No chat in this project has that in its title or in any message. Try a shorter word, or start a new chat.'
                : 'Start a chat to give the agent its first task in this project.'
            }
            action={
              <Button size="sm" onClick={createConversation}>
                New chat
              </Button>
            }
          />
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((conversation) => {
              const active = conversation.id === activeConversationId;
              const renaming = renamingId === conversation.id;

              return (
                <li key={conversation.id}>
                  <div
                    className={cn(
                      'group/row flex items-center gap-1 rounded-md px-1.5 py-1',
                      active ? 'bg-surface-2' : 'hover:bg-surface-2/60',
                    )}
                  >
                    {renaming ? (
                      <>
                        <Input
                          inputSize="sm"
                          autoFocus
                          value={draft}
                          aria-label="Conversation title"
                          onChange={(event) => setDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') commitRename(conversation.id);
                            if (event.key === 'Escape') setRenamingId(null);
                          }}
                        />
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Save title"
                          onClick={() => commitRename(conversation.id)}
                        >
                          <Check className="size-3.5" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Cancel rename"
                          onClick={() => setRenamingId(null)}
                        >
                          <X className="size-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          aria-current={active ? 'true' : undefined}
                          onClick={() => {
                            selectConversation(conversation.id);
                            onPick?.();
                          }}
                          className="min-w-0 flex-1 rounded-sm px-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span
                            className={cn(
                              'block truncate text-[12.5px]',
                              active ? 'font-medium text-fg' : 'text-muted',
                            )}
                          >
                            {conversation.title}
                          </span>
                          <span className="karo-numeric mt-0.5 flex items-center gap-2 text-[10.5px] text-subtle">
                            <span>
                              {conversation.lastMessageAt
                                ? formatRelativeTime(conversation.lastMessageAt)
                                : formatRelativeTime(conversation.updatedAt)}
                            </span>
                            {conversation.totalWeightedTokens > 0 ? (
                              <span>
                                {formatCompactNumber(conversation.totalWeightedTokens)} wt
                              </span>
                            ) : null}
                            {conversation.totalChargedMicroUsd > 0 ? (
                              <span className="text-ember-soft-fg">
                                {formatMicroUsd(conversation.totalChargedMicroUsd)}
                              </span>
                            ) : null}
                          </span>
                        </button>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              className="size-6 shrink-0 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                              aria-label={`Actions for ${conversation.title}`}
                            >
                              <EllipsisVertical className="size-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => {
                                setDraft(conversation.title);
                                setRenamingId(conversation.id);
                              }}
                            >
                              Rename
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="danger"
                              onSelect={() => deleteConversation(conversation.id)}
                            >
                              Delete chat
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {bodyHits.length > 0 ? (
          <section aria-label="Matches inside messages" className="mt-2">
            <h3 className="px-1.5 py-1 text-[10.5px] font-medium tracking-wide text-subtle uppercase">
              Found in messages
            </h3>
            <ul className="space-y-0.5">
              {bodyHits.map((hit) => (
                <li key={hit.conversationId}>
                  <button
                    type="button"
                    onClick={() => {
                      selectConversation(hit.conversationId);
                      onPick?.();
                    }}
                    className="w-full rounded-md px-1.5 py-1 text-left hover:bg-surface-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="block truncate text-[12.5px] text-muted">
                      {hit.conversationTitle}
                    </span>
                    <span className="karo-truncate-2 mt-0.5 block text-[11px] leading-snug text-subtle">
                      {hit.role === 'assistant'
                        ? 'Agent: '
                        : hit.role === 'user'
                          ? 'You: '
                          : ''}
                      {hit.snippet}
                    </span>
                    {hit.updatedAt ? (
                      <span className="karo-numeric mt-0.5 block text-[10.5px] text-subtle">
                        {formatRelativeTime(hit.updatedAt)}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
