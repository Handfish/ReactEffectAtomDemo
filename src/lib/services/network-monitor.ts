import { Context, Effect, Layer, PubSub, Stream, SubscriptionRef } from "effect";

export class NetworkMonitor extends Context.Tag("NetworkMonitor")<
  NetworkMonitor,
  {
    readonly isOnline: SubscriptionRef.SubscriptionRef<boolean>;
    readonly onOnline: Stream.Stream<void>;
  }
>() {
  static readonly Default = Layer.scoped(
    NetworkMonitor,
    Effect.gen(function* () {
      const isOnline = yield* SubscriptionRef.make(navigator.onLine);
      const pubsub = yield* PubSub.unbounded<void>();

      const handleOnline = () => {
        Effect.runSync(SubscriptionRef.set(isOnline, true));
        Effect.runSync(PubSub.publish(pubsub, void 0));
      };

      const handleOffline = () => {
        Effect.runSync(SubscriptionRef.set(isOnline, false));
      };

      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          window.removeEventListener("online", handleOnline);
          window.removeEventListener("offline", handleOffline);
        })
      );

      return {
        isOnline,
        onOnline: Stream.fromPubSub(pubsub),
      };
    })
  );
}
