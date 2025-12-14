import { runtimeAtom } from "@/lib/app-runtime";
import { MessagesService } from "@/lib/services/messages/service";
import { Message, MessageId } from "@/types/message";
import { Atom, Result, useAtomValue } from "@effect-atom/atom-react";
import { Array as Arr, Chunk, DateTime, Duration, Effect, Option, Queue, Stream } from "effect";
import React from "react";

// ============================================================================
// Messages Atom (for initial data loading)
// ============================================================================

export const messagesAtom = runtimeAtom
  .atom(
    Effect.gen(function* () {
      const service = yield* MessagesService;
      return yield* service.getMessages();
    }),
  )
  .pipe(Atom.keepAlive);

// ============================================================================
// Batch Processor Atom (handles the stream with logging)
// ============================================================================

const batchProcessorAtom = runtimeAtom
  .atom(
    Effect.gen(function* () {
      const service = yield* MessagesService;
      const markAsReadQueue = yield* Queue.unbounded<MessageId>();

      yield* Stream.fromQueue(markAsReadQueue).pipe(
        Stream.tap((value) => Effect.log(`Queued up ${value}`)),
        Stream.groupedWithin(25, Duration.seconds(5)),
        Stream.tap((batch) => Effect.log(`Batching: ${Chunk.join(batch, ", ")}`)),
        Stream.mapEffect((batch) => service.sendMarkAsReadBatch(batch), { concurrency: "unbounded" }),
        Stream.runDrain,
        Effect.catchAllCause((cause) => Effect.log(cause, "Error in markAsRead batch processor")),
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
  return useAtomValue(messagesAtom);
};

export const useMarkMessagesAsRead = (messages: Message[]) => {
  const processorResult = useAtomValue(batchProcessorAtom);
  const [readMessageIds, setReadMessageIds] = React.useState<Set<string>>(new Set());
  const queuedMessageIds = React.useRef(new Set<string>());

  const unreadMessages = React.useMemo(
    () => messages.filter((message) => message.readAt === null && !readMessageIds.has(message.id)),
    [messages, readMessageIds],
  );

  const offer = React.useCallback(
    (id: Message["id"]) => {
      // Skip if already queued
      if (queuedMessageIds.current.has(id)) {
        return;
      }
      queuedMessageIds.current.add(id);

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
      const element = document.querySelector(`[data-message-id="${message.id}"]`);
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

  // Create observer once with stable callback
  const observerCallback = React.useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (!document.hasFocus()) return;

      Arr.forEach(entries, (entry) => {
        if (!entry.isIntersecting) return;

        const messageId = Option.fromNullable(entry.target.getAttribute("data-message-id")).pipe(
          Option.flatMap(Option.liftPredicate((str) => str !== "")),
        );

        if (Option.isSome(messageId)) {
          offer(messageId.value as Message["id"]);
          observer.current?.unobserve(entry.target);
        }
      });
    },
    [offer],
  );

  React.useEffect(() => {
    observer.current = new IntersectionObserver(observerCallback, {
      threshold: 1,
    });

    return () => observer.current?.disconnect();
  }, [observerCallback]);

  // Re-observe unread messages when observer or messages change
  React.useEffect(() => {
    if (!observer.current) return;

    unreadMessages.forEach((message) => {
      const element = document.querySelector(`[data-message-id="${message.id}"]`);
      if (element) {
        observer.current?.observe(element);
      }
    });
  }, [unreadMessages]);

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

  return { observer, messages: messagesWithReadStatus };
};
