import { Message } from "@/types/message";
import { MessageBubble } from "./message-bubble";
import React from "react";

type Props = {
  messages: Message[];
  observer: React.RefObject<IntersectionObserver | null>;
};

export const MessageList = ({ messages, observer }: Props) => {
  return (
    <div className="flex flex-col gap-4 p-4">
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          data-message-id={message.id}
          ref={(el) => {
            if (el && message.readAt === null) {
              observer.current?.observe(el);
            }
          }}
        />
      ))}
    </div>
  );
};
