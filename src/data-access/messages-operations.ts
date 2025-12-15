import { useVisibilityTracker } from "@/hooks/useVisibilityTracker";
import { MessagesClient } from "@/lib/api/messages-client";
import { appRuntime } from "@/lib/app-runtime";
import { NetworkMonitor } from "@/lib/services/network-monitor";
import { Message, MessageId } from "@/types/message";
import { Atom, Result, useAtom, useAtomValue } from "@effect-atom/atom-react";
import { Chunk, DateTime, Duration, Effect, Option, Queue, Schedule, Stream } from "effect";
import React from "react";

// ============================================================================
// Messages Query with Infinite Scroll (using Atom.pull)
// ============================================================================

// Create a stream that fetches messages page by page using paginateEffect
const messagesStream = Stream.paginateEffect(undefined as string | undefined, (cursor) =>
  Effect.gen(function* () {
    const client = yield* MessagesClient;
    const response = yield* client.messages.getMessages({
      urlParams: cursor !== undefined ? { cursor } : {},
    });

    const nextState =
      response.nextCursor !== null ? Option.some(response.nextCursor) : Option.none();
    return [response.messages, nextState] as const;
  }),
);

// Use Atom.pull to create a pull-based atom for infinite scroll
export const messagesAtom = appRuntime.pull(messagesStream).pipe(Atom.keepAlive);

// React Hooks for message stream
export const useMessagesQuery = () => {
  const [result, pull] = useAtom(messagesAtom);
  return { result, pull };
};

// ============================================================================
// Batch Processor Atom (handles the stream with batching)
// ============================================================================

// Track which message IDs have been queued to avoid duplicates
const queuedMessageIds = new Set<string>();

const batchProcessorAtom = appRuntime
  .atom(
    Effect.gen(function* () {
      const client = yield* MessagesClient;
      const networkMonitor = yield* NetworkMonitor;
      const markAsReadQueue = yield* Queue.unbounded<MessageId>();

      yield* Stream.fromQueue(markAsReadQueue).pipe(
        Stream.tap((value) => Effect.log(`Queued up ${value}`)),
        Stream.groupedWithin(25, Duration.seconds(5)),
        Stream.tap((batch) => Effect.log(`Batching: ${Chunk.join(batch, ", ")}`)),
        Stream.mapEffect(
          (batch) =>
            client.messages
              .markAsRead({
                payload: { messageIds: Chunk.toReadonlyArray(batch) as MessageId[] },
              })
              .pipe(
                networkMonitor.latch.whenOpen,
                Effect.retry({ times: 3, schedule: Schedule.exponential("500 millis", 2) }),
                Effect.tap(() => Effect.log(`Batched: ${Chunk.join(batch, ", ")}`)),
                Effect.catchAllCause((cause) => Effect.log(cause, "Error processing batch")),
              ),
          { concurrency: 1 },
        ),
        Stream.runDrain,
        Effect.forkScoped,
      );

      return { markAsReadQueue };
    }),
  )
  .pipe(Atom.keepAlive);

// ============================================================================
// React Hook for Batch Updating
// ============================================================================

export const useMarkMessagesAsRead = (messages: readonly Message[]) => {
  const processorResult = useAtomValue(batchProcessorAtom);
  const [readMessageIds, setReadMessageIds] = React.useState<Set<string>>(new Set());

  // Mark a message as read: queue it for batching + optimistic update
  const markAsRead = React.useCallback(
    (id: Message["id"]) => {
      if (queuedMessageIds.has(id)) return;
      queuedMessageIds.add(id);

      if (Result.isSuccess(processorResult)) {
        processorResult.value.markAsReadQueue.unsafeOffer(id);
      }

      setReadMessageIds((prev) => new Set(prev).add(id));
    },
    [processorResult],
  );

  // Track visibility and mark as read when elements become visible
  const { setElementRef, getElement } = useVisibilityTracker({
    onVisible: markAsRead,
    skipIds: readMessageIds,
  });

  // Handle focus events - mark visible unread messages as read
  const unreadMessages = React.useMemo(
    () => messages.filter((msg) => msg.readAt === null && !readMessageIds.has(msg.id)),
    [messages, readMessageIds],
  );

  React.useEffect(() => {
    const handleFocus = () => {
      if (!document.hasFocus()) return;

      unreadMessages.forEach((message) => {
        const element = getElement(message.id);
        if (!element) return;

        const rect = element.getBoundingClientRect();
        const isFullyVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;

        if (isFullyVisible) {
          markAsRead(message.id);
        }
      });
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [unreadMessages, getElement, markAsRead]);

  // Merge read status for optimistic updates
  const messagesWithReadStatus = React.useMemo(
    () =>
      messages.map((msg) =>
        readMessageIds.has(msg.id) && msg.readAt === null
          ? { ...msg, readAt: DateTime.unsafeNow() }
          : msg,
      ),
    [messages, readMessageIds],
  );

  return { setElementRef, messages: messagesWithReadStatus };
};
