import { Layer, Logger } from "effect";
import { Atom } from "@effect-atom/atom-react";
import { MessagesService } from "@/lib/services/messages/service";

const AppLayer = Layer.mergeAll(Logger.pretty, MessagesService.Default);

export const runtimeAtom = Atom.runtime(AppLayer);
