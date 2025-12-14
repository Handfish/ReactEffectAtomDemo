import { Result } from "@effect-atom/atom-react";
import { Cause } from "effect";
import {
  useMessagesQuery,
  useMarkMessagesAsRead,
} from "@/data-access/messages-operations";
import { MessageList } from "./message-list";
import { MessageListSkeleton } from "./message-list-skeleton";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

export const ChatContainer: React.FC = () => {
  const messagesResult = useMessagesQuery();

  return (
    <div className="flex h-full flex-col rounded-lg border bg-card">
      <div className="border-b p-4">
        <h2 className="text-lg font-semibold">Messages</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        {Result.builder(messagesResult)
          .onInitial(() => <MessageListSkeleton />)
          .onFailure((cause) => (
            <div className="flex h-full flex-col items-center justify-center gap-4 p-4">
              <AlertCircle className="size-12 text-destructive" />
              <div className="text-center">
                <p className="font-semibold text-destructive">
                  Error loading messages
                </p>
                <p className="text-sm text-muted-foreground">
                  {Cause.pretty(cause)}
                </p>
              </div>
              <Button variant="outline" onClick={() => window.location.reload()}>
                <AlertCircle className="size-4" />
                Retry
              </Button>
            </div>
          ))
          .onSuccess((messages, { waiting }) => (
            <>
              {waiting && (
                <div className="border-b bg-muted/50 px-4 py-2 text-center text-sm text-muted-foreground">
                  Refreshing...
                </div>
              )}
              <MessageListWithReadTracking messages={messages} />
            </>
          ))
          .render()}
      </div>
    </div>
  );
};

// Separate component to use the hook with messages
const MessageListWithReadTracking: React.FC<{
  messages: import("@/types/message").Message[];
}> = ({ messages: initialMessages }) => {
  const { observer, messages } = useMarkMessagesAsRead(initialMessages);
  return <MessageList messages={messages} observer={observer} />;
};
