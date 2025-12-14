import { Result } from "@effect-atom/atom-react";
import {
  useMessagesQuery,
  useMarkMessagesAsRead,
} from "@/data-access/messages-operations";
import { MessageList } from "./message-list";
import { MessageListSkeleton } from "./message-list-skeleton";

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
          .onSuccess((messages, result) => (
            <>
              {result.waiting && (
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
