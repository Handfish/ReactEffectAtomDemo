import { Message, MessageId } from "@/types/message";
import { Atom, Result, useAtom, useAtomValue } from "@effect-atom/atom-react";
import { appRuntime } from "@/lib/app-runtime";
import { MessagesClient } from "@/lib/api/messages-client";
import { NetworkMonitor } from "@/lib/services/network-monitor";
import { Array as Arr, Chunk, DateTime, Duration, Effect, Option, Queue, Schedule, Stream } from "effect";
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

    const nextState = response.nextCursor !== null ? Option.some(response.nextCursor) : Option.none();
    return [response.messages, nextState] as const;
  }),
);

// Use Atom.pull to create a pull-based atom for infinite scroll
export const messagesAtom = appRuntime.pull(messagesStream).pipe(Atom.keepAlive);

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
// React Hooks
// ============================================================================

export const useMessagesQuery = () => {
  const [result, pull] = useAtom(messagesAtom);
  return { result, pull };
};

export const useMarkMessagesAsRead = (messages: readonly Message[]) => {
  const processorResult = useAtomValue(batchProcessorAtom);
  const [readMessageIds, setReadMessageIds] = React.useState<Set<string>>(new Set());

  // Store refs in a Map keyed by message ID
  const elementRefs = React.useRef<Map<string, HTMLElement>>(new Map());

  const unreadMessages = React.useMemo(
    () => messages.filter((message) => message.readAt === null && !readMessageIds.has(message.id)),
    [messages, readMessageIds],
  );

  const offer = React.useCallback(
    (id: Message["id"]) => {
      // Skip if already queued (module-level deduplication)
      if (queuedMessageIds.has(id)) {
        return;
      }
      queuedMessageIds.add(id);

      // Add to queue for batching (if processor is ready)
      if (Result.isSuccess(processorResult)) {
        processorResult.value.markAsReadQueue.unsafeOffer(id);
      }

      // Optimistic update via React state
      setReadMessageIds((prev) => new Set(prev).add(id));
    },
    [processorResult],
  );

  // Handle focus events - mark visible unread messages as read
  const markVisibleUnreadMessages = React.useCallback(() => {
    unreadMessages.forEach((message) => {
      const element = elementRefs.current.get(message.id);
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const isFullyVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;

      if (isFullyVisible) {
        offer(message.id);
      }
    });
  }, [offer, unreadMessages]);

  React.useEffect(() => {
    const handleFocus = () => {
      if (!document.hasFocus()) return;
      markVisibleUnreadMessages();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [markVisibleUnreadMessages]);

  // IntersectionObserver for visibility tracking
  const observer = React.useRef<IntersectionObserver | null>(null);

  // Helper to find message ID from element via reverse lookup
  const findMessageIdByElement = React.useCallback((element: Element): Message["id"] | undefined => {
    for (const [id, el] of elementRefs.current) {
      if (el === element) return id as Message["id"];
    }
    return undefined;
  }, []);

  // Create observer once with stable callback
  const observerCallback = React.useCallback(
    (entries: IntersectionObserverEntry[]) => {
      Arr.forEach(entries, (entry) => {
        if (!entry.isIntersecting) return;

        const messageId = findMessageIdByElement(entry.target);
        if (messageId) {
          offer(messageId);
        }

        observer.current?.unobserve(entry.target);
      });
    },
    [offer, findMessageIdByElement],
  );

  React.useEffect(() => {
    observer.current = new IntersectionObserver(observerCallback, {
      threshold: 1,
    });

    return () => observer.current?.disconnect();
  }, [observerCallback]);

  // Ref callback to register/unregister elements and observe unread ones
  const setElementRef = React.useCallback(
    (id: Message["id"], element: HTMLElement | null) => {
      if (element) {
        elementRefs.current.set(id, element);
        // Observe if unread
        if (!readMessageIds.has(id)) {
          observer.current?.observe(element);
        }
      } else {
        elementRefs.current.delete(id);
      }
    },
    [readMessageIds],
  );

  // Merge read status: return messages with readAt updated for optimistically marked messages
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
