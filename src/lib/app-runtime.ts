import { Atom } from "@effect-atom/atom-react";
import { Layer, Logger } from "effect";
import { MessagesClient } from "@/lib/api/messages-client";
import { NetworkMonitor } from "@/lib/services/network-monitor";

const AppLayer = Layer.mergeAll(Logger.pretty, MessagesClient.layer, NetworkMonitor.Default);

export const appRuntime = Atom.runtime(AppLayer);
